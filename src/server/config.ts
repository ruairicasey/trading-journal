import path from "node:path";
import { z } from "zod";

/**
 * The ONLY place that reads process.env. Personal values (wallets, balances, account names)
 * never live in code — they come from .env.local or the database.
 */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  VERCEL_ENV: optional, // "production" | "preview" | "development" when on Vercel
  DATA_DIR: z.string().default("./data"),
  DATABASE_URL: optional,
  DATABASE_AUTH_TOKEN: optional,
  APP_TIMEZONE: z.string().default("Australia/Melbourne"),
  HL_API_URL: z.string().url().default("https://api.hyperliquid.xyz"),
  HL_WALLET_ADDRESS: optional.refine((v) => !v || /^0x[0-9a-fA-F]{40}$/.test(v), {
    message: "HL_WALLET_ADDRESS must be a 0x-prefixed 40-hex address",
  }),
  AUTH_PASSWORD_HASH: optional,
  AUTH_SECRET: optional,
  CRON_SECRET: optional,
  STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
  R2_ACCOUNT_ID: optional,
  R2_ACCESS_KEY_ID: optional,
  R2_SECRET_ACCESS_KEY: optional,
  R2_BUCKET: optional,
  TJ_DEMO: optional, // set by `npm run dev:demo`
});

export type AppConfig = ReturnType<typeof buildConfig>;

function buildConfig(env: NodeJS.ProcessEnv) {
  const e = EnvSchema.parse(env);
  const dataDir = path.resolve(e.DATA_DIR);
  const isVercelPreview = e.VERCEL_ENV === "preview";
  const isDeployed = e.NODE_ENV === "production" && !!e.VERCEL_ENV;
  return {
    env: e.NODE_ENV,
    isDeployed,
    /** Preview deployments get no data access (secrets are scoped to Production only). */
    isVercelPreview,
    /** Running against the synthetic demo database. */
    isDemo: e.TJ_DEMO === "1",
    dataDir,
    uploadsDir: path.join(dataDir, "uploads"),
    db: {
      url: e.DATABASE_URL ?? `file:${path.join(dataDir, "journal.db")}`,
      authToken: e.DATABASE_AUTH_TOKEN,
    },
    timezone: e.APP_TIMEZONE,
    hyperliquid: { apiUrl: e.HL_API_URL, bootstrapWallet: e.HL_WALLET_ADDRESS?.toLowerCase() },
    auth: { passwordHash: e.AUTH_PASSWORD_HASH, secret: e.AUTH_SECRET, cronSecret: e.CRON_SECRET },
    storage: {
      driver: e.STORAGE_DRIVER,
      r2: {
        accountId: e.R2_ACCOUNT_ID,
        accessKeyId: e.R2_ACCESS_KEY_ID,
        secretAccessKey: e.R2_SECRET_ACCESS_KEY,
        bucket: e.R2_BUCKET,
      },
    },
  };
}

let cached: AppConfig | undefined;
export function getConfig(): AppConfig {
  return (cached ??= buildConfig(process.env));
}

/** For tests/scripts only. */
export function resetConfigForTests() {
  cached = undefined;
}

/** Mask an address for logs: 0x12ab…cdef. Never log full addresses. */
export function maskAddress(addr: string) {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "…";
}
