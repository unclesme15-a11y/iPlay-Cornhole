export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Append-only. Never edit a migration that has shipped: add a new one. The runner stores a checksum
 * of each applied migration and refuses to start if one was changed.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'accounts, sessions, matches, moderation, live matches',
    sql: `
CREATE TABLE accounts (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  display_name_changed_at timestamptz,
  is_guest boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned')),
  ban_reason text,
  banned_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  provider text NOT NULL CHECK (provider IN ('apple', 'google')),
  subject text NOT NULL,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_account_idx ON identities (account_id);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  platform text,
  client_version text
);
CREATE INDEX sessions_account_idx ON sessions (account_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE matches (
  id text PRIMARY KEY,
  code text NOT NULL,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  ended_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('score', 'skunk', 'forfeit', 'abandoned')),
  winner text CHECK (winner IN ('A', 'B')),
  score_a int NOT NULL,
  score_b int NOT NULL,
  innings int NOT NULL,
  rematch_of text
);
CREATE INDEX matches_code_idx ON matches (code);
CREATE INDEX matches_ended_idx ON matches (ended_at DESC);

CREATE TABLE match_players (
  match_id text NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seat text NOT NULL,
  team text NOT NULL,
  account_id text REFERENCES accounts(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('human', 'bot')),
  bot_level text,
  character_id text,
  left_early boolean NOT NULL DEFAULT false,
  throws int NOT NULL DEFAULT 0,
  holes int NOT NULL DEFAULT 0,
  boards int NOT NULL DEFAULT 0,
  fouls int NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, seat)
);
CREATE INDEX match_players_account_idx ON match_players (account_id);

CREATE TABLE player_stats (
  account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  games int NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  losses int NOT NULL DEFAULT 0,
  leaves int NOT NULL DEFAULT 0,
  throws int NOT NULL DEFAULT 0,
  holes int NOT NULL DEFAULT 0,
  boards int NOT NULL DEFAULT 0,
  fouls int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE live_matches (
  id text PRIMARY KEY,
  phase text NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE blocks (
  blocker_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE reports (
  id serial PRIMARY KEY,
  reporter_id text REFERENCES accounts(id) ON DELETE SET NULL,
  reported_id text REFERENCES accounts(id) ON DELETE SET NULL,
  match_id text,
  reason text NOT NULL CHECK (reason IN ('harassment', 'cheating', 'inappropriate_name', 'other')),
  note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX reports_status_idx ON reports (status, created_at);
`,
  },
  {
    version: 2,
    name: 'anonymise match history inside the database when an account is deleted',
    // Doing this in a trigger (not in application code) means it also holds if a match result is
    // being saved at the very moment an account is deleted.
    sql: `
CREATE FUNCTION anonymise_match_players() RETURNS trigger AS $$
BEGIN
  UPDATE match_players SET display_name = 'Deleted player' WHERE account_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounts_anonymise_history BEFORE DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION anonymise_match_players();
`,
  },
  {
    version: 3,
    name: 'adult confirmation, ranked play, ratings and leaderboards',
    sql: `
-- Every iPlay game is for adults: we keep when the player confirmed it and which terms they accepted.
ALTER TABLE accounts
  ADD COLUMN adult_confirmed_at timestamptz,
  ADD COLUMN terms_version text,
  ADD COLUMN show_on_leaderboards boolean NOT NULL DEFAULT true;

ALTER TABLE reports DROP CONSTRAINT reports_reason_check;
ALTER TABLE reports ADD CONSTRAINT reports_reason_check
  CHECK (reason IN ('harassment', 'cheating', 'inappropriate_name', 'underage', 'other'));

ALTER TABLE matches
  ADD COLUMN ranked text CHECK (ranked IN ('singles', 'teams')),
  ADD COLUMN voided boolean NOT NULL DEFAULT false;
-- A result can only be saved once, so retrying a save that already went through does nothing.
CREATE UNIQUE INDEX matches_code_created_uniq ON matches (code, created_at);
CREATE INDEX matches_ranked_idx ON matches (ended_at DESC) WHERE ranked IS NOT NULL;

ALTER TABLE match_players
  ADD COLUMN rating_before int,
  ADD COLUMN rating_after int;

-- One rating per player for 1v1.
CREATE TABLE singles_ratings (
  account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  rating int NOT NULL,
  peak int NOT NULL,
  games int NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  losses int NOT NULL DEFAULT 0,
  streak int NOT NULL DEFAULT 0,
  last_played_at timestamptz NOT NULL
);
CREATE INDEX singles_ratings_rank_idx ON singles_ratings (rating DESC, games DESC);

-- One rating per pair of partners for 2v2. member_a is the first of the two ids in plain string order, so a pair is one row.
CREATE TABLE duo_ratings (
  duo_key text PRIMARY KEY,
  member_a text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  member_b text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  rating int NOT NULL,
  peak int NOT NULL,
  games int NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  losses int NOT NULL DEFAULT 0,
  streak int NOT NULL DEFAULT 0,
  last_played_at timestamptz NOT NULL,
  CHECK (member_a <> member_b)
);
CREATE INDEX duo_ratings_rank_idx ON duo_ratings (rating DESC, games DESC);
CREATE INDEX duo_ratings_member_a_idx ON duo_ratings (member_a);
CREATE INDEX duo_ratings_member_b_idx ON duo_ratings (member_b);

-- Players who walk out of a ranked match wait before queueing again.
CREATE TABLE ranked_cooldowns (
  account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  until timestamptz NOT NULL,
  reason text NOT NULL
);
`,
  },
  {
    version: 4,
    name: 'account deletion requests from the website',
    sql: `
-- Google Play requires a web page where people can ask for their account to be deleted without the app.
-- Staff handle each request by hand (admin API); handled requests are removed after 90 days.
CREATE TABLE deletion_requests (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  display_name text NOT NULL,
  contact text NOT NULL,
  account_id text,
  details text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'rejected')),
  handled_at timestamptz,
  note text
);
CREATE INDEX deletion_requests_status_idx ON deletion_requests (status, created_at);
`,
  },
];
