import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { getConfig } from "../config";
import type { DB } from "./client";
import * as s from "./schema";
import { DEFAULT_QUICK_FILTERS, DEFAULT_SESSIONS, SEED_VOCAB } from "./seed-data";

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export async function runMigrations(db: DB) {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

const SEED_VERSION = 1;

/**
 * Idempotent first-run seed. Each block runs once (tracked in settings.seed_version), so items
 * you delete/archive later are never re-added. Never overwrites user data.
 */
export async function seedDefaults(db: DB, opts: { accountName?: string } = {}) {
  const cfg = getConfig();
  const current = await db.query.settings.findFirst({ where: eq(s.settings.key, "seed_version") });
  const version = (current?.value as number | undefined) ?? 0;
  if (version >= SEED_VERSION) return { seeded: false };

  await db.transaction(async (tx) => {
    // settings
    const defaults: Record<string, unknown> = {
      timezone: cfg.timezone,
      include_spot: false,
      auto_sync_minutes: 5,
      sessions: DEFAULT_SESSIONS,
      privacy_default: false,
    };
    for (const [key, value] of Object.entries(defaults)) {
      await tx.insert(s.settings).values({ key, value }).onConflictDoNothing();
    }

    // default account (generic name; rename in Settings)
    const existing = await tx.select({ id: s.accounts.id }).from(s.accounts).limit(1);
    let accountId = existing[0]?.id;
    if (!accountId) {
      const [acc] = await tx
        .insert(s.accounts)
        .values({ name: opts.accountName ?? "Main", type: "crypto", startingBalance: 0, standardRiskPct: 1 })
        .returning({ id: s.accounts.id });
      accountId = acc.id;
    }

    // optional wallet from .env.local (read once on first run)
    const wallet = cfg.hyperliquid.bootstrapWallet;
    if (wallet) {
      await tx.insert(s.wallets).values({ accountId, address: wallet, label: "Main" }).onConflictDoNothing();
    }

    // vocab
    for (const [kind, groups] of Object.entries(SEED_VOCAB) as [s.VocabKind, (typeof SEED_VOCAB)[s.VocabKind]][]) {
      const have = await tx.select({ id: s.vocabItems.id }).from(s.vocabItems).where(eq(s.vocabItems.kind, kind)).limit(1);
      if (have.length) continue;
      for (const [gi, group] of groups.entries()) {
        let categoryId: string | null = null;
        if (group.category) {
          const [cat] = await tx
            .insert(s.vocabCategories)
            .values({ kind, name: group.category, sort: gi })
            .returning({ id: s.vocabCategories.id });
          categoryId = cat.id;
        }
        await tx.insert(s.vocabItems).values(group.items.map((label, i) => ({ kind, categoryId, label, sort: i })));
      }
    }

    // built-in quick filters
    const haveFilters = await tx.select({ id: s.savedFilters.id }).from(s.savedFilters).limit(1);
    if (!haveFilters.length) {
      await tx
        .insert(s.savedFilters)
        .values(DEFAULT_QUICK_FILTERS.map((f, i) => ({ name: f.name, query: f.query, builtin: true, sort: i })));
    }

    await tx
      .insert(s.settings)
      .values({ key: "seed_version", value: SEED_VERSION })
      .onConflictDoUpdate({ target: s.settings.key, set: { value: SEED_VERSION } });
  });
  return { seeded: true };
}
