import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const bool = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true');

const semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'must look like 1.2.3');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    MAX_MATCHES: z.coerce.number().int().positive().default(5000),
    /** Requests per minute per IP across the API. */
    RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(300),
    /** Set to true when running behind a load balancer so rate limits use the real client IP. */
    TRUST_PROXY: bool(false),

    /** postgres://... in production. pglite://memory or pglite://./dir for local development. */
    DATABASE_URL: z.string().optional(),
    DATABASE_SSL: bool(false),
    /** How long a new server waits for an old one to hand over live matches during a deploy. */
    OWNERSHIP_WAIT_SEC: z.coerce.number().int().min(0).default(90),
    /** Saved live matches older than this are dropped on boot instead of restored. */
    RESTORE_MAX_AGE_MIN: z.coerce.number().int().positive().default(120),

    /** The address invite links point at, for example https://play.iplay.example */
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    DEEP_LINK_SCHEME: z.string().regex(/^[a-z][a-z0-9+.-]*$/).default('iplaycornhole'),
    IOS_STORE_URL: z.string().url().optional(),
    ANDROID_STORE_URL: z.string().url().optional(),
    /** For universal links / app links. Leave empty until the apps exist. */
    APPLE_TEAM_ID: z.string().optional(),
    IOS_BUNDLE_ID: z.string().optional(),
    ANDROID_PACKAGE: z.string().optional(),
    ANDROID_CERT_SHA256: csv,

    /** Apps older than this are told to update. 0.0.0 turns the check off. */
    MIN_CLIENT_VERSION: semver.default('0.0.0'),
    LATEST_CLIENT_VERSION: semver.optional(),

    /** Bundle / service ids Apple tokens must be issued for. Empty turns Apple sign-in off. */
    APPLE_CLIENT_IDS: csv,
    /** OAuth client ids Google tokens must be issued for. Empty turns Google sign-in off. */
    GOOGLE_CLIENT_IDS: csv,
    /** Accept sign-ins with no nonce. Off by default: a nonce stops a stolen token being replayed. */
    ALLOW_MISSING_NONCE: bool(false),
    ALLOW_GUESTS: bool(true),

    /** Every iPlay game is for adults. New accounts must confirm they are 18 or older. */
    REQUIRE_ADULT_CONFIRMATION: bool(true),
    /** Bump when the terms change: apps then ask players to accept again. */
    TERMS_VERSION: z.coerce.number().int().min(1).default(1),

    /** Protects /admin. At least 32 characters. Leave unset to turn the admin API off. */
    ADMIN_TOKEN: z.string().min(32, 'ADMIN_TOKEN must be at least 32 characters').optional(),
    /** Start with new matches switched off (deploys, incidents). */
    MAINTENANCE: bool(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.DATABASE_URL || !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
        ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'production needs a postgres:// DATABASE_URL' });
      }
    }
    if (env.LATEST_CLIENT_VERSION && compareVersions(env.LATEST_CLIENT_VERSION, env.MIN_CLIENT_VERSION) < 0) {
      ctx.addIssue({ code: 'custom', path: ['LATEST_CLIENT_VERSION'], message: 'cannot be older than MIN_CLIENT_VERSION' });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

/** Compares 1.2.3 style versions: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Reads and validates environment variables. Throws with a readable message if any are bad. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return parsed.data;
}
