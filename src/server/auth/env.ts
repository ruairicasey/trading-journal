/**
 * Auth-related environment, readable from the EDGE runtime (middleware). This is the one deliberate
 * exception to "only src/server/config.ts reads env": config.ts uses Node APIs, which middleware can't load.
 *
 * Rules:
 *  - Auth is ON whenever a password hash is configured, and ALWAYS in production.
 *  - Fail closed: if auth is on but the hash or secret is missing/weak, every request gets 503.
 *  - Vercel preview deployments never get data access (their env vars are Production-only by design).
 */
export type AuthEnv = {
  passwordHash?: string;
  secret?: string;
  cronSecret?: string;
  production: boolean;
  isPreview: boolean;
  authEnabled: boolean;
  misconfigured: string | null;
};

const val = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
export const MIN_SECRET_LENGTH = 32;

export function readAuthEnv(env: Record<string, string | undefined> = process.env): AuthEnv {
  const passwordHash = val(env.AUTH_PASSWORD_HASH);
  const secret = val(env.AUTH_SECRET);
  const cronSecret = val(env.CRON_SECRET);
  const production = env.NODE_ENV === "production";
  const isPreview = env.VERCEL_ENV === "preview";
  const authEnabled = production || !!passwordHash;

  let misconfigured: string | null = null;
  if (authEnabled) {
    if (!passwordHash) misconfigured = "AUTH_PASSWORD_HASH is not set";
    else if (!passwordHash.startsWith("scrypt:")) misconfigured = "AUTH_PASSWORD_HASH is not a hash from `npm run hash-password`";
    else if (!secret) misconfigured = "AUTH_SECRET is not set";
    else if (secret.length < MIN_SECRET_LENGTH) misconfigured = `AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`;
  }
  return { passwordHash, secret, cronSecret, production, isPreview, authEnabled, misconfigured };
}
