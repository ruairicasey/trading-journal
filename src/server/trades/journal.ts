/**
 * Edit Trade: load + save (Basic, Analysis and Notes tabs; one autosave payload).
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
import { MAX_TAGS, REFLECTION_PROMPTS } from "../../lib/journal-options";

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
  analysis: z
    .object({
      entryTimeframe: z.enum(s.TIMEFRAMES).nullable(),
      timeframeClass: z.enum(s.TIMEFRAME_CLASSES).nullable(),
      marketCondition: z.enum(s.MARKET_CONDITIONS).nullable(),
      htfTimeframes: z.array(z.enum(s.HTF_TIMEFRAMES)).max(s.HTF_TIMEFRAMES.length),
      emotionBeforeId: id.nullable(),
      grade: z.enum(s.GRADES).nullable(),
      entryRetests: z.number().int().min(0).max(20).nullable(),
      maxRReached: num.min(0).max(50).nullable(),
      riskMultiplier: num.min(0.05).max(10).nullable(),
      confluences: z.array(id).max(200),
      slReasons: z.array(id).max(100),
      tpReasons: z.array(id).max(100),
    })
    .optional(),
  notes: z
    .object({
      rationale: z.string().max(20_000).nullable(),
      postNotes: z.string().max(20_000).nullable(),
      reflection: z.partialRecord(z.enum(REFLECTION_PROMPTS.map((p) => p.key) as [string, ...string[]]), z.string().max(5_000)),
      tags: z.array(z.string().trim().min(1).max(40)).max(MAX_TAGS),
      rulesFollowed: z.enum(s.RULES_FOLLOWED).nullable(),
      exitReasonId: id.nullable(),
      emotionAfterId: id.nullable(),
      processCompliant: z.boolean().nullable(),
      mistakes: z.array(id).max(100),
    })
    .optional(),
});
export type BasicInput = z.infer<typeof BasicInputSchema>;
export const TradeInputSchema = BasicInputSchema;
export type TradeInput = BasicInput;

/** Vocab kinds the Analysis/Notes tabs manage, mapped from payload keys. */
const LINKED_KINDS = { confluences: "confluence", slReasons: "sl_reason", tpReasons: "tp_reason", mistakes: "mistake" } as const;

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
  const selectedBy = (kind: s.VocabKind) => vocab.filter((v) => v.kind === kind).map((v) => v.itemId);
  const [allVocab, categories, tagRows, allTags, shots] = await Promise.all([
    db
      .select({
        id: s.vocabItems.id,
        kind: s.vocabItems.kind,
        label: s.vocabItems.label,
        categoryId: s.vocabItems.categoryId,
        favorite: s.vocabItems.favorite,
        archived: s.vocabItems.archived,
      })
      .from(s.vocabItems)
      .where(inArray(s.vocabItems.kind, ["confluence", "sl_reason", "tp_reason", "mistake", "emotion", "exit_reason"]))
      .orderBy(asc(s.vocabItems.sort), asc(s.vocabItems.label)),
    db
      .select({ id: s.vocabCategories.id, kind: s.vocabCategories.kind, name: s.vocabCategories.name, archived: s.vocabCategories.archived })
      .from(s.vocabCategories)
      .orderBy(asc(s.vocabCategories.sort)),
    db
      .select({ name: s.tags.name })
      .from(s.tradeTags)
      .innerJoin(s.tags, eq(s.tags.id, s.tradeTags.tagId))
      .where(eq(s.tradeTags.tradeId, tradeId)),
    db
      .select({ name: s.tags.name, n: sql<number>`count(${s.tradeTags.tradeId})` })
      .from(s.tags)
      .leftJoin(s.tradeTags, eq(s.tradeTags.tagId, s.tags.id))
      .groupBy(s.tags.id)
      .orderBy(desc(sql`2`), asc(s.tags.name))
      .limit(200),
    db.select().from(s.screenshots).where(eq(s.screenshots.tradeId, tradeId)).orderBy(asc(s.screenshots.sort), asc(s.screenshots.createdAt)),
  ]);
  const used = new Set(vocab.map((v) => v.itemId));
  for (const k of ["emotionBeforeId", "emotionAfterId", "exitReasonId"] as const) if (journal?.[k]) used.add(journal[k]!);
  const vocabByKind = (kind: s.VocabKind) => allVocab.filter((v) => v.kind === kind && (!v.archived || used.has(v.id)));
  return {
    vocab: {
      confluence: vocabByKind("confluence"),
      sl_reason: vocabByKind("sl_reason"),
      tp_reason: vocabByKind("tp_reason"),
      mistake: vocabByKind("mistake"),
      emotion: vocabByKind("emotion"),
      exit_reason: vocabByKind("exit_reason"),
    },
    categories: categories.filter((c) => !c.archived),
    selected: {
      confluences: selectedBy("confluence"),
      slReasons: selectedBy("sl_reason"),
      tpReasons: selectedBy("tp_reason"),
      mistakes: selectedBy("mistake"),
    },
    tags: tagRows.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
    tagSuggestions: allTags.map((t) => t.name),
    screenshots: shots.map((x) => ({ id: x.id, url: `/api/files/${x.storageKey}`, caption: x.caption, width: x.width, height: x.height })),
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

  // Analysis/Notes vocab: keep only ids that really are of the expected kind.
  const linkInput: { kind: s.VocabKind; ids: string[] }[] = [];
  if (input.analysis) {
    linkInput.push({ kind: LINKED_KINDS.confluences, ids: input.analysis.confluences });
    linkInput.push({ kind: LINKED_KINDS.slReasons, ids: input.analysis.slReasons });
    linkInput.push({ kind: LINKED_KINDS.tpReasons, ids: input.analysis.tpReasons });
  }
  if (input.notes) linkInput.push({ kind: LINKED_KINDS.mistakes, ids: input.notes.mistakes });
  const singleIds = [input.analysis?.emotionBeforeId, input.notes?.emotionAfterId, input.notes?.exitReasonId].filter(Boolean) as string[];
  const wanted = [...new Set([...linkInput.flatMap((l) => l.ids), ...singleIds])];
  const kindOf = new Map(
    wanted.length
      ? (await db.select({ id: s.vocabItems.id, kind: s.vocabItems.kind }).from(s.vocabItems).where(inArray(s.vocabItems.id, wanted))).map((r) => [r.id, r.kind])
      : [],
  );
  const validSingle = (v: string | null | undefined, kind: s.VocabKind) => (v && kindOf.get(v) === kind ? v : null);
  const links = linkInput.map((l) => ({ kind: l.kind, ids: [...new Set(l.ids)].filter((i) => kindOf.get(i) === l.kind) }));

  const existingJournal = await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, tradeId) });
  const now = Date.now();
  const n = input.notes;
  const reviewFilled =
    !!n && (!!n.postNotes?.trim() || n.rulesFollowed !== null || n.exitReasonId !== null || n.processCompliant !== null || n.mistakes.length > 0);

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
      ...(input.analysis
        ? {
            entryTimeframe: input.analysis.entryTimeframe,
            timeframeClass: input.analysis.timeframeClass,
            marketCondition: input.analysis.marketCondition,
            htfTimeframes: [...new Set(input.analysis.htfTimeframes)],
            emotionBeforeId: validSingle(input.analysis.emotionBeforeId, "emotion"),
            grade: input.analysis.grade,
            entryRetests: input.analysis.entryRetests,
            maxRReached: input.analysis.maxRReached,
            riskMultiplier: input.analysis.riskMultiplier,
          }
        : {}),
      ...(n
        ? {
            rationale: n.rationale?.trim() ? n.rationale : null,
            postNotes: n.postNotes?.trim() ? n.postNotes : null,
            reflection: Object.fromEntries(
              Object.entries(n.reflection).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== ""),
            ),
            rulesFollowed: n.rulesFollowed,
            exitReasonId: validSingle(n.exitReasonId, "exit_reason"),
            emotionAfterId: validSingle(n.emotionAfterId, "emotion"),
            processCompliant: n.processCompliant,
            // first time a review is filled in
            ...(reviewFilled && !existingJournal?.reviewedAt ? { reviewedAt: now } : {}),
          }
        : {}),
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

    for (const l of links) {
      await tx.delete(s.tradeVocab).where(and(eq(s.tradeVocab.tradeId, tradeId), eq(s.tradeVocab.kind, l.kind)));
      if (l.ids.length) await tx.insert(s.tradeVocab).values(l.ids.map((itemId) => ({ tradeId, itemId, kind: l.kind })));
    }

    if (n) {
      // tags: trimmed, de-duplicated case-insensitively, existing tags reused
      const names: string[] = [];
      for (const t of n.tags.map((x) => x.trim()).filter(Boolean)) {
        if (!names.some((x) => x.toLowerCase() === t.toLowerCase())) names.push(t); // first spelling wins
      }
      const tagIds: string[] = [];
      for (const name of names) {
        const found = await tx.query.tags.findFirst({ where: sql`lower(${s.tags.name}) = ${name.toLowerCase()}` });
        if (found) tagIds.push(found.id);
        else tagIds.push((await tx.insert(s.tags).values({ name }).returning({ id: s.tags.id }))[0].id);
      }
      await tx.delete(s.tradeTags).where(eq(s.tradeTags.tradeId, tradeId));
      if (tagIds.length) await tx.insert(s.tradeTags).values(tagIds.map((tagId) => ({ tradeId, tagId })));
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

/** Full save (all tabs). `saveTradeBasic` is kept as the original name. */
export const saveTrade = saveTradeBasic;

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
