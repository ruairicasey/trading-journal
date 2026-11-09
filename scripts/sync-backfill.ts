/**
 * npm run sync:backfill — first big import (or catch-up) from your own machine, with no time budget.
 * Reads .env.local (DATABASE_URL / HL_WALLET_ADDRESS). Prints masked addresses only.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  if (process.env.TJ_DEMO === "1") throw new Error("Refusing to sync in demo mode.");
  const { getConfig, maskAddress } = await import("../src/server/config");
  const { getDb } = await import("../src/server/db/client");
  const { runMigrations, seedDefaults, ensureBootstrapWallet } = await import("../src/server/db/bootstrap");
  const { getHlClient } = await import("../src/server/hyperliquid");
  const { syncAll } = await import("../src/server/hyperliquid/sync");
  const s = await import("../src/server/db/schema");
  const { eq } = await import("drizzle-orm");

  const cfg = getConfig();
  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db);
  await ensureBootstrapWallet(db);

  const wallets = await db.select().from(s.wallets).where(eq(s.wallets.enabled, true));
  if (!wallets.length) {
    throw new Error("No wallets. Set HL_WALLET_ADDRESS in .env.local, or add one in Settings → Wallets & sync.");
  }
  console.log(`Database: ${cfg.db.url.startsWith("file:") ? cfg.db.url : "remote (libsql)"}`);
  for (const w of wallets) console.log(`Wallet "${w.label}" ${maskAddress(w.address)}`);

  const t0 = Date.now();
  const out = await syncAll(db, getHlClient(), {
    trigger: "backfill",
    onProgress: (label, e) => {
      if (e.phase === "fills" || e.phase === "funding") {
        console.log(`  [${label}] ${e.phase} page ${e.page}: ${e.fetched} fetched, ${e.inserted} new so far`);
      } else {
        console.log(`  [${label}] ${e.phase}: ${e.detail}`);
      }
    },
  });
  for (const r of out.results) {
    console.log(
      `\n${r.label}: ${r.status}. ${r.fillsNew} new fills, ${r.tradesTouched} trades built/updated, ` +
        `${r.fundingNew} funding rows, ${r.openPositions} open position(s), ${r.gapsDetected} gap warning(s)` +
        (r.error ? `\n  error: ${r.error}` : ""),
    );
  }
  console.log(`\nFinished in ${((Date.now() - t0) / 1000).toFixed(1)}s. Next: npm run verify:sync`);
  if (out.results.some((r) => r.status === "error")) process.exit(1);
}

main().catch((err) => {
  console.error("sync:backfill failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
