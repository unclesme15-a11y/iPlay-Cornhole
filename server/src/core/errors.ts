/** An error the caller caused and can act on. `status` is the HTTP status it maps to. */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    /** Extra fields the client may need (for example when a ban ends). Sent alongside `code` and `message`. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
