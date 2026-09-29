import type { Account } from '../accounts/service.js';
import type { ModerationService } from '../accounts/moderation.js';
import { DomainError } from '../core/errors.js';
import type { MatchSession } from '../lobby/session.js';
import { VivoxSigner } from './vivox.js';

export interface VoiceChannel {
  name: string;
  uri: string;
  joinToken: string;
}

export interface VoiceGrant {
  /** The person's own Vivox address (their account id). */
  identity: { username: string; uri: string };
  loginToken: string;
  /** Everyone at the match. */
  table: VoiceChannel;
  /** 2v2 only: just you and your partner. */
  team: VoiceChannel | null;
  /** Who is at the match, so the app can label speaking indicators without knowing anyone's Vivox address. */
  roster: Array<{ seat: string; team: string; username: string; displayName: string }>;
  /** Vivox usernames the player has blocked. The app must mute these locally. */
  mute: string[];
  expiresAt: string;
}

/**
 * Hands seated players the tokens they need to talk. Voice is not filtered, so it is for adults only,
 * blocked players are muted on the blocker's phone, and the app offers a report button.
 */
export class VoiceService {
  private readonly signer: VivoxSigner | null;

  constructor(
    config: Parameters<typeof VivoxSigner.fromConfig>[0],
    private readonly moderation: ModerationService,
    private readonly now: () => number,
  ) {
    this.signer = VivoxSigner.fromConfig(config);
  }

  get enabled(): boolean {
    return this.signer !== null;
  }

  async grant(session: MatchSession, account: Account): Promise<VoiceGrant> {
    const signer = this.signer;
    if (!signer) throw new DomainError('voice_unavailable', 'Voice chat is not switched on for this server', 501);
    const view = session.view(account.id);
    if (!view.you) throw new DomainError('not_in_match', 'Only players in this match can use its voice chat', 403);
    if (view.phase === 'abandoned') throw new DomainError('match_over', 'This match has ended', 409);

    const now = this.now();
    const humans = view.seats.filter((s) => s.kind === 'human' && s.accountId && !s.controlledByBot);
    const roster = humans.map((s) => ({ seat: s.id, team: s.team, username: s.accountId!, displayName: s.name ?? '' }));
    const inMatch = new Set(roster.map((r) => r.username));
    const blocks = await this.moderation.listBlocks(account.id);

    const tableName = `cornhole-${session.id}`;
    const login = signer.sign('login', account.id, null, now);
    const table = signer.sign('join', account.id, tableName, now);
    let team: VoiceChannel | null = null;
    let expiresAt = Math.min(login.expiresAt, table.expiresAt);
    if (view.config.mode === '2v2') {
      const name = `${tableName}-team-${view.you.team}`;
      const t = signer.sign('join', account.id, name, now);
      team = { name, uri: t.channelUri!, joinToken: t.token };
      expiresAt = Math.min(expiresAt, t.expiresAt);
    }
    return {
      identity: { username: account.id, uri: signer.userUri(account.id) },
      loginToken: login.token,
      table: { name: tableName, uri: table.channelUri!, joinToken: table.token },
      team,
      roster,
      mute: blocks.map((b) => b.accountId).filter((id) => inMatch.has(id)),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }
}
