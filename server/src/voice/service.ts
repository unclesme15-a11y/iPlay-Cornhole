import type { Account } from '../accounts/service.js';
import type { ModerationService } from '../accounts/moderation.js';
import { DomainError } from '../core/errors.js';
import type { MatchSession } from '../lobby/session.js';
import { VivoxSigner, type VivoxAction } from './vivox.js';

export interface VoiceChannel {
  name: string;
  uri: string;
}

export interface VoiceGrant {
  /**
   * Use this as the Vivox display name when logging in. It is the account id, so other phones can tell
   * who is speaking and which people to mute, without seeing any real name or Vivox identity.
   */
  displayName: string;
  /** Everyone at the match. */
  table: VoiceChannel;
  /** 2v2 only: just you and your partner. */
  team: VoiceChannel | null;
  /** Who is at the match: the display name each person logs in with, and their seat. */
  roster: Array<{ seat: string; team: string; username: string; displayName: string }>;
  /** Display names (account ids) the player has blocked. The app must mute these locally. */
  mute: string[];
}

export interface VoiceToken {
  accessToken: string;
  /** ISO time the token stops working. */
  expiresAt: string;
}

/**
 * Tells seated players which voice channels they may use and signs the tokens to join them. Voice is
 * not filtered, so it is for adults only, blocked players are muted on the blocker's phone, and the
 * app offers a report button.
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

  private requireSigner(): VivoxSigner {
    if (!this.signer) throw new DomainError('voice_unavailable', 'Voice chat is not switched on for this server', 501);
    return this.signer;
  }

  /** The channels this player may use in this match, or throws if they may not use voice here. */
  private channelsFor(session: MatchSession, account: Account, signer: VivoxSigner): { table: VoiceChannel; team: VoiceChannel | null; view: ReturnType<MatchSession['view']> } {
    const view = session.view(account.id);
    if (!view.you) throw new DomainError('not_in_match', 'Only players in this match can use its voice chat', 403);
    if (view.phase === 'abandoned') throw new DomainError('match_over', 'This match has ended', 409);
    const tableName = `cornhole-${session.id}`;
    const table = { name: tableName, uri: signer.channelUri(tableName) };
    let team: VoiceChannel | null = null;
    if (view.config.mode === '2v2') {
      const name = `${tableName}-team-${view.you.team}`;
      team = { name, uri: signer.channelUri(name) };
    }
    return { table, team, view };
  }

  async grant(session: MatchSession, account: Account): Promise<VoiceGrant> {
    const signer = this.requireSigner();
    const { table, team, view } = this.channelsFor(session, account, signer);
    const humans = view.seats.filter((s) => s.kind === 'human' && s.accountId && !s.controlledByBot);
    const roster = humans.map((s) => ({ seat: s.id, team: s.team, username: s.accountId!, displayName: s.name ?? '' }));
    const inMatch = new Set(roster.map((r) => r.username));
    const blocks = await this.moderation.listBlocks(account.id);
    return {
      displayName: account.id,
      table,
      team,
      roster,
      mute: blocks.map((b) => b.accountId).filter((id) => inMatch.has(id)),
    };
  }

  /**
   * Signs one token for the Vivox identity the phone presents. A `join` is only signed for this
   * player's own channels: the match's table channel, and (in 2v2) their own team's channel.
   */
  token(session: MatchSession, account: Account, req: { action: VivoxAction; channelUri?: string | undefined; fromUserUri?: string | undefined }): VoiceToken {
    const signer = this.requireSigner();
    const { table, team } = this.channelsFor(session, account, signer);
    const from = req.fromUserUri?.trim() || signer.userUri(account.id);
    if (!signer.isOurUserUri(from)) throw new DomainError('voice_identity_invalid', 'That voice identity does not belong to this game', 400);
    let channelName: string | null = null;
    if (req.action !== 'login') {
      const wanted = req.channelUri?.trim().toLowerCase();
      const allowed = [table, team].filter((c): c is VoiceChannel => c !== null).find((c) => c.uri.toLowerCase() === wanted);
      if (!allowed) throw new DomainError('voice_channel_forbidden', 'You can only join the voice channels of your own match and team', 403);
      channelName = allowed.name;
    }
    const signed = signer.sign(req.action, from, channelName, this.now());
    return { accessToken: signed.token, expiresAt: new Date(signed.expiresAt).toISOString() };
  }
}
