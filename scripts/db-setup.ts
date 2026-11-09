/**
 * Apply migrations and seed defaults (idempotent). Runs before `npm run dev` and in the Vercel build.
 * On Vercel preview builds it does nothing: previews have no database credentials by design.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== "production") {
    console.log(`db-setup: skipped on Vercel ${vercelEnv} (no data access outside Production)`);
    return;
  }
  const { getDb } = await import("../src/server/db/client");
  const { runMigrations, seedDefaults, ensureBootstrapWallet } = await import("../src/server/db/bootstrap");
  const db = getDb();
  await runMigrations(db);
  const { seeded } = await seedDefaults(db);
  const walletAdded = await ensureBootstrapWallet(db);
  console.log(
    `db-setup: migrations applied${seeded ? ", defaults seeded" : ""}${walletAdded ? ", wallet added from HL_WALLET_ADDRESS" : ""}`,
  );
}

main().catch((err) => {
  console.error("db-setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
