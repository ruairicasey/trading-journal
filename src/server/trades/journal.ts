/**
 * Edit Trade: load + save (Basic tab).
 *
 * OWNERSHIP: for exchange-synced trades the server IGNORES every exchange-owned field in the payload
 * (pair, direction, status, prices, size, times, fees) even if a client sends them. Only journal data
 * (and which account the trade belongs to) can change. Manual trades are fully user-owned, so their
 * metrics are recomputed here from the entered values.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { displayPair, parseCoin } from "../hyperliquid/markets";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { manualMetrics, sizeFromRisk, totalSize, tpAllocation, weightedAvg } from "../../lib/trade-math";

const num = z.number().finite();
const price = num.positive().max(1e12);
const id = z.string().min(1).max(64);

export const BasicInputSchema = z.object({
  accountId: id,
  strategyId: id.nullable(),
  stopLoss: price.nullable(),
  takeProfit: price.nullable(),
  sizeMode: z.enum(s.SIZE_MODES),
  plannedRiskUsd: num.min(0).max(1e9).nullable(),
  leverageOverride: num.min(0).max(1000).nullable(),
  session: z.string().trim().max(40).nullable(),
  tradeType: z.enum(s.TRADE_TYPES).nullable(),
  feeOverride: num.min(-1e6).max(1e6).nullable(),
  checklist: z.array(id).max(100),
  tpPartials: z.array(z.object({ price, pct: num.gt(0).max(100) })).max(20),
  manual: z
    .object({
      coin: z.string().trim().min(1).max(40),
      direction: z.enum(s.DIRECTIONS),
      status: z.enum(s.TRADE_STATUSES),
      entry: price.nullable(),
      exit: price.nullable(),
      size: num.positive().max(1e15).nullable(),
      entryTime: z.number().int().min(0).nullable(),
      exitTime: z.number().int().min(0).nullable(),
      dca: z.array(z.object({ price, size: num.positive().max(1e15) })).max(50),
    })
    .optional(),
});
export type BasicInput = z.infer<typeof BasicInputSchema>;

export type SaveResult =
  | { ok: true; savedAt: number }
  | { ok: false; errors: Partial<Record<"tpPartials" | "manual" | "accountId" | "strategyId" | "form", string>> };

export async function loadTradeForEdit(db: DB, accountId: string, tradeId: string) {
  const trade = await db.query.trades.findFirst({
    where: and(eq(s.trades.id, tradeId), eq(s.trades.accountId, accountId), isNull(s.trades.deletedAt)),
  });
  if (!trade) return null;
  const [journal, vocab, partials, entryLegs, strategies, checklistItems, recent] = await Promise.all([
    db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, tradeId) }),
    db.select().from(s.tradeVocab).where(eq(s.tradeVocab.tradeId, tradeId)),
    db.select().from(s.tradePartials).where(eq(s.tradePartials.tradeId, tradeId)).orderBy(asc(s.tradePartials.sort)),
    db
      .select()
      .from(s.tradeFills)
      .where(and(eq(s.tradeFills.tradeId, tradeId), eq(s.tradeFills.role, "entry")))
      .orderBy(asc(s.tradeFills.time)),
    db
      .select({ id: s.vocabItems.id, label: s.vocabItems.label, archived: s.vocabItems.archived })
      .from(s.vocabItems)
      .where(eq(s.vocabItems.kind, "strategy"))
      .orderBy(asc(s.vocabItems.sort)),
    db
      .select({ id: s.vocabItems.id, label: s.vocabItems.label, archived: s.vocabItems.archived })
      .from(s.vocabItems)
      .where(eq(s.vocabItems.kind, "checklist"))
      .orderBy(asc(s.vocabItems.sort)),
    db
      .select({ coin: s.trades.coin, last: sql<number>`max(coalesce(${s.trades.entryTime}, ${s.trades.createdAt}))` })
      .from(s.trades)
      .where(and(eq(s.trades.accountId, accountId), isNull(s.trades.deletedAt)))
      .groupBy(s.trades.coin)
      .orderBy(desc(sql`2`))
      .limit(8),
  ]);
  const checked = new Set(vocab.filter((v) => v.kind === "checklist").map((v) => v.itemId));
  return {
    trade,
    journal: journal ?? null,
    checklistIds: [...checked],
    tpPartials: partials.filter((p) => p.kind === "tp").map((p) => ({ price: p.price, pct: p.pct ?? 0 })),
    dca: partials.filter((p) => p.kind === "entry").map((p) => ({ price: p.price, size: p.sizeUnits ?? 0 })),
    entryLegs: entryLegs.map((l) => ({ time: l.time, price: l.px, size: l.sz })),
    // keep archived items only if this trade already uses them
    strategies: strategies.filter((x) => !x.archived || x.id === journal?.strategyId),
    checklistItems: checklistItems.filter((x) => !x.archived || checked.has(x.id)),
    recentPairs: recent.map((r) => r.coin),
  };
}

export type TradeEditData = NonNullable<Awaited<ReturnType<typeof loadTradeForEdit>>>;

export async function saveTradeBasic(db: DB, currentAccountId: string, tradeId: string, raw: unknown): Promise<SaveResult> {
  const parsed = BasicInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, errors: { form: `${issue.path.join(".") || "input"}: ${issue.message}` } };
  }
  const input = parsed.data;
  const trade = await db.query.trades.findFirst({
    where: and(eq(s.trades.id, tradeId), eq(s.trades.accountId, currentAccountId), isNull(s.trades.deletedAt)),
  });
  if (!trade) return { ok: false, errors: { form: "Trade not found" } };
  const manual = trade.source === "manual";

  // ── validation ──
  const errors: Extract<SaveResult, { ok: false }>["errors"] = {};
  const account = await db.query.accounts.findFirst({ where: eq(s.accounts.id, input.accountId) });
  if (!account || account.archived) errors.accountId = "Unknown account";
  if (input.strategyId) {
    const st = await db.query.vocabItems.findFirst({ where: eq(s.vocabItems.id, input.strategyId) });
    if (!st || st.kind !== "strategy") errors.strategyId = "Unknown strategy";
  }
  if (!tpAllocation(input.tpPartials).valid) errors.tpPartials = "Take-profit allocations must add up to 100%";
  if (manual && input.manual) {
    const m = input.manual;
    if (m.status === "closed" && (m.exit === null || (m.size === null && !m.dca.length && input.sizeMode !== "risk"))) {
      errors.manual = "A closed trade needs an exit price and a size";
    }
    if (m.entryTime && m.exitTime && m.exitTime < m.entryTime) errors.manual = "Exit time is before entry time";
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const checklist = input.checklist.length
    ? (
        await db
          .select({ id: s.vocabItems.id })
          .from(s.vocabItems)
          .where(and(inArray(s.vocabItems.id, input.checklist), eq(s.vocabItems.kind, "checklist")))
      ).map((r) => r.id)
    : [];

  const now = Date.now();
  await db.transaction(async (tx) => {
    // account move is allowed for any trade (sync never rewrites account_id on existing trades)
    const tradeSet: Partial<typeof s.trades.$inferInsert> = { accountId: input.accountId };

    let manualJournal: Partial<typeof s.tradeJournal.$inferInsert> = {};
    if (manual && input.manual) {
      const m = input.manual;
      const entry = m.dca.length ? weightedAvg(m.dca) : m.entry;
      let size = m.dca.length ? totalSize(m.dca) : m.size;
      if (input.sizeMode === "risk" && !m.dca.length) size = sizeFromRisk(input.plannedRiskUsd, entry, input.stopLoss) ?? size;
      const coin = m.coin;
      const p = parseCoin(coin);
      Object.assign(
        tradeSet,
        {
          coin,
          displayPair: displayPair(coin),
          dex: p.dex,
          marketType: p.marketType,
          direction: m.direction,
          status: m.status,
          fillCount: 0,
          reconstructedAt: null,
        },
        manualMetrics({
          direction: m.direction,
          entry,
          exit: m.exit,
          size,
          fees: input.feeOverride,
          entryTime: m.entryTime,
          exitTime: m.exitTime,
          closed: m.status === "closed",
        }),
      );
      manualJournal = {
        manualEntry: entry,
        manualExit: m.exit,
        manualSize: size,
        manualEntryTime: m.entryTime,
        manualExitTime: m.exitTime,
        feeOverride: input.feeOverride,
      };
    }
    await tx.update(s.trades).set(tradeSet).where(eq(s.trades.id, tradeId));

    const journalSet = {
      strategyId: input.strategyId,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      sizeMode: input.sizeMode,
      plannedRiskUsd: input.plannedRiskUsd,
      leverageOverride: input.leverageOverride,
      session: input.session || null,
      tradeType: input.tradeType,
      ...manualJournal,
      updatedAt: now,
    };
    await tx
      .insert(s.tradeJournal)
      .values({ tradeId, ...journalSet })
      .onConflictDoUpdate({ target: s.tradeJournal.tradeId, set: journalSet });

    await tx.delete(s.tradeVocab).where(and(eq(s.tradeVocab.tradeId, tradeId), eq(s.tradeVocab.kind, "checklist")));
    if (checklist.length) {
      await tx.insert(s.tradeVocab).values(checklist.map((itemId) => ({ tradeId, itemId, kind: "checklist" as const })));
    }

    const kinds: ("tp" | "entry")[] = manual ? ["tp", "entry"] : ["tp"];
    await tx.delete(s.tradePartials).where(and(eq(s.tradePartials.tradeId, tradeId), inArray(s.tradePartials.kind, kinds)));
    const partialRows = [
      ...input.tpPartials.map((p, i) => ({ tradeId, kind: "tp" as const, price: p.price, pct: p.pct, sort: i })),
      ...(manual && input.manual ? input.manual.dca.map((d, i) => ({ tradeId, kind: "entry" as const, price: d.price, sizeUnits: d.size, sort: i })) : []),
    ];
    if (partialRows.length) await tx.insert(s.tradePartials).values(partialRows);
  });
  return { ok: true, savedAt: now };
}

export async function createStrategy(db: DB, label: string): Promise<string> {
  const clean = z.string().trim().min(1).max(120).parse(label);
  const existing = await db.query.vocabItems.findFirst({
    where: and(eq(s.vocabItems.kind, "strategy"), sql`lower(${s.vocabItems.label}) = lower(${clean})`),
  });
  if (existing) {
    if (existing.archived) await db.update(s.vocabItems).set({ archived: false }).where(eq(s.vocabItems.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .select({ n: sql<number>`coalesce(max(${s.vocabItems.sort}), -1) + 1` })
    .from(s.vocabItems)
    .where(eq(s.vocabItems.kind, "strategy"));
  const [ins] = await db
    .insert(s.vocabItems)
    .values({ kind: "strategy", label: clean, sort: Number(row?.n ?? 0) })
    .returning({ id: s.vocabItems.id });
  return ins.id;
}
