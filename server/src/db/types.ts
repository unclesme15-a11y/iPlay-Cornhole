export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  /** Run one parameterised statement ($1, $2, ...). */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
  /** Run several statements with no parameters (used by migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly kind: 'pg' | 'pglite';
  /** Run `fn` in a transaction. Commits if it returns, rolls back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /**
   * Become the one server instance that owns live matches. Returns false if another instance
   * already does. Held until `releaseOwnership` or `close`.
   */
  tryOwnership(): Promise<boolean>;
  releaseOwnership(): Promise<void>;
  /** Called if ownership is lost after it was acquired (for example the database connection dropped). */
  onOwnershipLost(handler: () => void): void;
  close(): Promise<void>;
}
