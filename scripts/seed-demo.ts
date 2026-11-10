/**
 * npm run seed:demo — (re)build a fake demo account in ./data/demo/journal.db.
 * Synthetic data only. Refuses to run against any other database.
 */
import fs from "node:fs";
import { applyDemoEnv, DEMO_DATA_DIR, DEMO_DB_FILE } from "./demo-env";

applyDemoEnv();

async function main() {
  const { getConfig } = await import("../src/server/config");
  const cfg = getConfig();
  if (cfg.db.url !== `file:${DEMO_DB_FILE}`) throw new Error(`Refusing to seed demo data into ${cfg.db.url}`);

  fs.mkdirSync(DEMO_DATA_DIR, { recursive: true });
  for (const f of fs.readdirSync(DEMO_DATA_DIR)) if (f.startsWith("journal.db")) fs.rmSync(`${DEMO_DATA_DIR}/${f}`);
  // demo screenshots live in data/demo/uploads (never the real uploads folder)
  if (cfg.uploadsDir.startsWith(DEMO_DATA_DIR)) fs.rmSync(cfg.uploadsDir, { recursive: true, force: true });

  const { getDb } = await import("../src/server/db/client");
  const { runMigrations, seedDefaults } = await import("../src/server/db/bootstrap");
  const s = await import("../src/server/db/schema");
  const { DEFAULT_SESSIONS } = await import("../src/server/db/seed-data");
  const { generateDemoHistory, DEMO_ADDRESS, DEMO_SEED } = await import("../src/server/demo/generate");
  const { seedDemoJournal } = await import("../src/server/demo/journal");
  const { createRng } = await import("../src/server/demo/rng");
  const { insertFills, rebuildTrades } = await import("../src/server/reconstruct/persist");

  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db, { accountName: "Demo account" });
  const [account] = await db.select().from(s.accounts);
  const { eq } = await import("drizzle-orm");
  await db.update(s.accounts).set({ startingBalance: 25_000, standardRiskPct: 1 }).where(eq(s.accounts.id, account.id));
  const [wallet] = await db
    .insert(s.wallets)
    .values({ accountId: account.id, address: DEMO_ADDRESS, label: "Demo", autoSync: false })
    .returning();

  const history = generateDemoHistory({ end: Date.now() });
  const { inserted } = await insertFills(db, wallet.id, history.fills);
  const rebuilt = await rebuildTrades(db, { walletId: wallet.id, accountId: account.id });
  const last = history.fills.at(-1)?.time ?? null;
  await db
    .update(s.wallets)
    .set({ lastFillTime: last, oldestFillTime: history.fills[0]?.time ?? null, backfillCompletedAt: Date.now() })
    .where(eq(s.wallets.id, wallet.id));
  const journal = await seedDemoJournal(db, createRng(DEMO_SEED + 1), {
    walletId: wallet.id,
    plans: history.plans,
    sessions: DEFAULT_SESSIONS,
  });

  // synthetic chart screenshots for ~30% of journaled trades
  const { demoChartPng } = await import("../src/server/demo/chart-png");
  const { addScreenshot } = await import("../src/server/screenshots");
  const { LocalStorage } = await import("../src/server/storage/local");
  const storage = new LocalStorage(cfg.uploadsDir);
  const shotRng = createRng(DEMO_SEED + 2);
  const journaled = new Set((await db.select({ id: s.tradeJournal.tradeId }).from(s.tradeJournal)).map((r) => r.id));
  const byKey = new Map((await db.select().from(s.trades)).map((t) => [t.externalKey, t]));
  let shots = 0;
  for (const plan of history.plans) {
    const t = byKey.get(`${wallet.id}:${plan.coin}:${plan.firstTid}${plan.keySuffix}`);
    if (!t || !journaled.has(t.id) || !shotRng.chance(0.3)) continue;
    const png = demoChartPng(shotRng, { entry: plan.entryPx, stop: plan.stopLoss, target: plan.takeProfit, direction: plan.direction });
    await addScreenshot(db, storage, { accountId: account.id, tradeId: t.id, bytes: png, width: 960, height: 540, caption: "Entry (demo chart)" });
    shots++;
  }

  console.log(
    `seed:demo → ${DEMO_DB_FILE}\n  ${inserted} fills, ${rebuilt.created} trades, ${journal.journaled} journaled (${journal.total - journal.journaled} left blank), ${shots} screenshots`,
  );
}

main().catch((err) => {
  console.error("seed:demo failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
