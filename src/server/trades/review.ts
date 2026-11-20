/**
 * The review flow's save. It writes ONLY the review fields you changed in the flow (compared with the values the
 * flow showed you), plus reviewed_at the first time. Everything else on the trade (rationale, tags, checklist,
 * stops, analysis, manual figures) is never touched, so an edit made elsewhere in the meantime survives.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { RulesCheckSchema } from "../../lib/rules-check";

const id = z.string().min(1).max(64);
export const ReviewFieldsSchema = z.object({
  grade: z.enum(s.GRADES).nullable(),
  strategyId: id.nullable(),
  emotionBeforeId: id.nullable(),
  emotionAfterId: id.nullable(),
  exitReasonId: id.nullable(),
  mistakes: z.array(id).max(100),
  postNotes: z.string().max(20_000).nullable(),
  rulesFollowed: z.enum(s.RULES_FOLLOWED).nullable(),
  /** which playbook rules you kept; only stored for the trade's strategy */
  rulesCheck: RulesCheckSchema.nullable(),
});
export type ReviewFields = z.infer<typeof ReviewFieldsSchema>;
export type ReviewSaveResult = { ok: true; reviewedAt: number } | { ok: false; error: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sortedSet = (ids: string[]) => [...new Set(ids)].sort();

export async function saveTradeReview(
  db: DB,
  accountId: string,
  tradeId: string,
  rawNext: unknown,
  rawBase: unknown,
  now = Date.now(),
): Promise<ReviewSaveResult> {
  const next = ReviewFieldsSchema.safeParse(rawNext);
  const base = ReviewFieldsSchema.safeParse(rawBase);
  if (!next.success || !base.success) return { ok: false, error: "Invalid review" };
  const n = { ...next.data, postNotes: next.data.postNotes?.trim() ? next.data.postNotes : null };
  const b = { ...base.data, postNotes: base.data.postNotes?.trim() ? base.data.postNotes : null };

  const trade = await db.query.trades.findFirst({
    where: and(eq(s.trades.id, tradeId), eq(s.trades.accountId, accountId), isNull(s.trades.deletedAt)),
  });
  if (!trade) return { ok: false, error: "Trade not found" };

  // vocab ids must be of the right kind
  const wanted = [
    ...new Set(
      [n.strategyId, n.emotionBeforeId, n.emotionAfterId, n.exitReasonId, ...n.mistakes].filter(
        Boolean,
      ) as string[],
    ),
  ];
  const kindOf = new Map(
    wanted.length
      ? (
          await db
            .select({ id: s.vocabItems.id, kind: s.vocabItems.kind })
            .from(s.vocabItems)
            .where(inArray(s.vocabItems.id, wanted))
        ).map((r) => [r.id, r.kind])
      : [],
  );
  const ok = (v: string | null, kind: s.VocabKind) => v === null || kindOf.get(v) === kind;
  if (!ok(n.strategyId, "strategy")) return { ok: false, error: "Unknown strategy" };
  if (!ok(n.emotionBeforeId, "emotion") || !ok(n.emotionAfterId, "emotion"))
    return { ok: false, error: "Unknown emotion" };
  if (!ok(n.exitReasonId, "exit_reason")) return { ok: false, error: "Unknown exit reason" };
  const mistakes = sortedSet(n.mistakes);
  if (mistakes.some((m) => kindOf.get(m) !== "mistake")) return { ok: false, error: "Unknown mistake" };

  const existing = await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, tradeId) });
  // a rules check counts only for the trade's strategy: the one this save sets, else the stored one (which may have
  // changed elsewhere since the flow loaded)
  const strategyChanging = !same(n.strategyId, b.strategyId);
  const strategy = strategyChanging ? n.strategyId : (existing?.strategyId ?? null);
  if (n.rulesCheck && n.rulesCheck.strategyId !== strategy) {
    if (strategyChanging) {
      n.rulesCheck = null; // the new strategy has no check yet, and the old one's answer no longer applies
      n.rulesFollowed = null;
    } else {
      n.rulesCheck = b.rulesCheck; // stale: leave both as stored
      n.rulesFollowed = b.rulesFollowed;
    }
  }

  const set: Partial<typeof s.tradeJournal.$inferInsert> = {};
  for (const k of [
    "grade",
    "strategyId",
    "emotionBeforeId",
    "emotionAfterId",
    "exitReasonId",
    "postNotes",
    "rulesFollowed",
    "rulesCheck",
  ] as const) {
    if (!same(n[k], b[k])) (set as Record<string, unknown>)[k] = n[k];
  }
  const mistakesChanged = !same(mistakes, sortedSet(b.mistakes));

  const reviewedAt = existing?.reviewedAt ?? now;
  await db.transaction(async (tx) => {
    const row = { ...set, reviewedAt, updatedAt: now };
    await tx
      .insert(s.tradeJournal)
      .values({ tradeId, ...row })
      .onConflictDoUpdate({ target: s.tradeJournal.tradeId, set: row });
    if (mistakesChanged) {
      await tx
        .delete(s.tradeVocab)
        .where(and(eq(s.tradeVocab.tradeId, tradeId), eq(s.tradeVocab.kind, "mistake")));
      if (mistakes.length)
        await tx
          .insert(s.tradeVocab)
          .values(mistakes.map((itemId) => ({ tradeId, itemId, kind: "mistake" as const })));
    }
  });
  return { ok: true, reviewedAt };
}
