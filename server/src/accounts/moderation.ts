import { DomainError } from '../core/errors.js';
import type { Db } from '../db/types.js';

export const REPORT_REASONS = ['harassment', 'cheating', 'inappropriate_name', 'underage', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

export interface ReportRecord {
  id: number;
  reporterId: string | null;
  reportedId: string | null;
  matchId: string | null;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  createdAt: Date;
  resolvedAt: Date | null;
}

interface ReportRow {
  id: number;
  reporter_id: string | null;
  reported_id: string | null;
  match_id: string | null;
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  created_at: Date;
  resolved_at: Date | null;
}

const toReport = (r: ReportRow): ReportRecord => ({
  id: r.id,
  reporterId: r.reporter_id,
  reportedId: r.reported_id,
  matchId: r.match_id,
  reason: r.reason,
  note: r.note,
  status: r.status,
  createdAt: r.created_at,
  resolvedAt: r.resolved_at,
});

const MAX_NOTE = 500;
const MAX_REPORTS_PER_HOUR = 10;

/** Blocking other players and reporting them. Reports go to a queue a person on your team reviews. */
export class ModerationService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number,
  ) {}

  // ------------------------------------------------------------------ blocks

  async block(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) throw new DomainError('bad_request', "You can't block yourself", 400);
    const exists = await this.db.query('SELECT 1 FROM accounts WHERE id = $1', [blockedId]);
    if (exists.rowCount === 0) throw new DomainError('unknown_account', 'Player not found', 404);
    await this.db.query('INSERT INTO blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
      blockerId,
      blockedId,
      new Date(this.now()),
    ]);
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.db.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
  }

  async listBlocks(blockerId: string): Promise<Array<{ accountId: string; displayName: string; blockedAt: Date }>> {
    const res = await this.db.query<{ blocked_id: string; display_name: string; created_at: Date }>(
      `SELECT b.blocked_id, a.display_name, b.created_at FROM blocks b JOIN accounts a ON a.id = b.blocked_id
       WHERE b.blocker_id = $1 ORDER BY b.created_at DESC`,
      [blockerId],
    );
    return res.rows.map((r) => ({ accountId: r.blocked_id, displayName: r.display_name, blockedAt: r.created_at }));
  }

  // ----------------------------------------------------------------- reports

  async report(input: { reporterId: string; reportedId: string; matchId?: string | undefined; reason: ReportReason; note?: string | undefined }): Promise<ReportRecord> {
    if (input.reporterId === input.reportedId) throw new DomainError('bad_request', "You can't report yourself", 400);
    if (!REPORT_REASONS.includes(input.reason)) throw new DomainError('bad_request', 'Unknown report reason', 400);
    const target = await this.db.query('SELECT 1 FROM accounts WHERE id = $1', [input.reportedId]);
    if (target.rowCount === 0) throw new DomainError('unknown_account', 'Player not found', 404);

    const since = new Date(this.now() - 60 * 60_000);
    const recent = await this.db.query<{ n: number }>('SELECT count(*)::int AS n FROM reports WHERE reporter_id = $1 AND created_at > $2', [input.reporterId, since]);
    if ((recent.rows[0]?.n ?? 0) >= MAX_REPORTS_PER_HOUR) throw new DomainError('too_many_reports', 'Too many reports. Try again later.', 429);

    // The same person reporting the same player again while the first is still open just returns the first.
    const dup = await this.db.query<ReportRow>(
      `SELECT * FROM reports WHERE reporter_id = $1 AND reported_id = $2 AND status = 'open' ORDER BY id DESC LIMIT 1`,
      [input.reporterId, input.reportedId],
    );
    if (dup.rows[0]) return toReport(dup.rows[0]);

    const res = await this.db.query<ReportRow>(
      `INSERT INTO reports (reporter_id, reported_id, match_id, reason, note, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.reporterId, input.reportedId, input.matchId?.slice(0, 40) ?? null, input.reason, input.note?.trim().slice(0, MAX_NOTE) || null, new Date(this.now())],
    );
    return toReport(res.rows[0]!);
  }

  async listReports(status: ReportStatus | 'all' = 'open', limit = 50): Promise<Array<ReportRecord & { reporterName: string | null; reportedName: string | null }>> {
    const res = await this.db.query<ReportRow & { reporter_name: string | null; reported_name: string | null }>(
      `SELECT r.*, a.display_name AS reporter_name, b.display_name AS reported_name FROM reports r
       LEFT JOIN accounts a ON a.id = r.reporter_id LEFT JOIN accounts b ON b.id = r.reported_id
       WHERE ($1 = 'all' OR r.status = $1) ORDER BY r.created_at ASC LIMIT $2`,
      [status, Math.min(200, Math.max(1, limit))],
    );
    return res.rows.map((r) => ({ ...toReport(r), reporterName: r.reporter_name, reportedName: r.reported_name }));
  }

  async resolveReport(id: number, status: 'resolved' | 'dismissed'): Promise<ReportRecord> {
    const res = await this.db.query<ReportRow>(
      `UPDATE reports SET status = $2, resolved_at = $3 WHERE id = $1 AND status = 'open' RETURNING *`,
      [id, status, new Date(this.now())],
    );
    if (!res.rows[0]) throw new DomainError('report_not_found', 'No open report with that id', 404);
    return toReport(res.rows[0]);
  }
}
