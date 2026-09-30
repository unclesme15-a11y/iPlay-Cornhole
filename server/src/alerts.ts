/**
 * Sends short messages to a chat webhook (Discord or Slack) so the owner hears about trouble without watching logs:
 * serious errors, the server (re)starting, new player reports and website deletion requests.
 * Set ALERT_WEBHOOK_URL to turn it on. Each kind of message is sent at most once per 10 minutes; anything held back is
 * counted and mentioned in the next one, so a storm of errors becomes one message, not hundreds.
 */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

export const ALERT_EVERY_MS = 10 * 60_000;

export class Alerts {
  private readonly last = new Map<string, number>();
  private readonly held = new Map<string, number>();
  /** Messages actually sent (for tests and the admin status). */
  sent = 0;

  constructor(
    private readonly url: string | undefined,
    private readonly label: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly now: () => number = Date.now,
    private readonly onFail: (error: unknown) => void = () => undefined,
  ) {}

  get enabled(): boolean {
    return Boolean(this.url);
  }

  /** Queue a message of a kind ("error", "report", ...). Never throws and never waits. */
  send(kind: string, text: string): void {
    if (!this.url) return;
    const t = this.now();
    const prev = this.last.get(kind);
    if (prev !== undefined && t - prev < ALERT_EVERY_MS) {
      this.held.set(kind, (this.held.get(kind) ?? 0) + 1);
      return;
    }
    this.last.set(kind, t);
    const more = this.held.get(kind) ?? 0;
    this.held.delete(kind);
    const message = `[${this.label}] ${text}${more > 0 ? ` (+${more} more like this in the last 10 minutes)` : ''}`.slice(0, 1900);
    const discord = /discord(app)?\.com\/api\/webhooks\//.test(this.url);
    this.sent++;
    void this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(discord ? { content: message } : { text: message }),
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => {
        if (!res.ok) this.onFail(new Error(`alert webhook answered ${res.status}`));
      })
      .catch((error) => this.onFail(error));
  }
}
