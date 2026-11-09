/**
 * Fills the demo account's journal with plausible, SYNTHETIC entries so every screen has data.
 * ~75% of trades get journal data; the rest stay blank so "missing context" nudges show up.
 */
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { sessionFor, type SessionDef } from "../../lib/sessions";
import type { DemoPlan } from "./generate";
import type { Rng } from "./rng";

const RATIONALES = [
  "Rotation back into value after a failed auction above VAH; entered on the retest of VAH from below.",
  "Reclaim of session VWAP with CVD confirming; HTF bias aligned, invalidation below the reclaim candle.",
  "Sweep of prior day low into the anchored VWAP from the swing low; took the first higher low.",
  "Range deviation and back inside; targeting the POC and the opposite side of value.",
  "Breakout above the weekly open held on the retest; trend continuation with VWAP rising.",
  "Naked POC from earlier in the week acted as a magnet; faded the move into the 2σ band.",
];
const POST_NOTES_WIN = [
  "Plan played out. Scaled at the first target and let the rest run to the opposite side of value.",
  "Good patience on entry. Could have held longer; exited before TP on noise.",
  "Clean trade. Stop never threatened after the retest.",
];
const POST_NOTES_LOSS = [
  "Level didn't hold; acceptance below VAL invalidated the idea. Stop did its job.",
  "Entered early before confirmation. Should have waited for the retest.",
  "Correct idea, poor timing: news spike took the stop before the move.",
];
const TAGS = ["a-setup", "news", "weekend", "scalp", "swing", "trend", "range", "fomc-week"];

type Vocab = Record<s.VocabKind, { id: string; label: string; categoryId: string | null }[]>;

async function loadVocab(db: DB): Promise<Vocab> {
  const rows = await db.select().from(s.vocabItems).where(eq(s.vocabItems.archived, false));
  const out = Object.fromEntries(s.VOCAB_KINDS.map((k) => [k, []])) as unknown as Vocab;
  for (const r of rows) out[r.kind].push({ id: r.id, label: r.label, categoryId: r.categoryId });
  return out;
}

export async function seedDemoJournal(
  db: DB,
  rng: Rng,
  opts: { walletId: string; plans: DemoPlan[]; sessions: SessionDef[] },
) {
  const vocab = await loadVocab(db);
  const byLabel = (kind: s.VocabKind, label: string) => vocab[kind].find((v) => v.label === label)?.id ?? null;
  const trades = await db.select().from(s.trades).where(eq(s.trades.walletId, opts.walletId));
  const byKey = new Map(trades.map((t) => [t.externalKey!, t]));
  const tagIds = new Map<string, string>();
  for (const name of TAGS) {
    const [t] = await db.insert(s.tags).values({ name }).returning({ id: s.tags.id });
    tagIds.set(name, t.id);
  }

  let journaled = 0;
  for (const plan of opts.plans) {
    const t = byKey.get(`${opts.walletId}:${plan.coin}:${plan.firstTid}${plan.keySuffix}`);
    if (!t || !rng.chance(0.75)) continue;
    journaled++;
    const win = (t.netPnl ?? 0) > 0;
    const full = rng.chance(0.8); // some entries are only partly filled in
    const grade = win ? rng.pick(["A+", "A", "A", "B", "B"] as const) : rng.pick(["A", "B", "C", "C", "D"] as const);
    const tfClass = rng.pick(["LTF", "LTF", "MTF", "MTF", "HTF"] as const);
    const entryTf = tfClass === "LTF" ? rng.pick(["1m", "3m", "5m"] as const) : tfClass === "MTF" ? rng.pick(["15m", "30m", "1H"] as const) : rng.pick(["4H", "1D"] as const);
    const rulesFollowed = win ? rng.pick(["yes", "yes", "yes", "partial"] as const) : rng.pick(["yes", "partial", "no"] as const);
    const exitReason = t.status === "open" ? null : win ? rng.pick(["TP hit", "Early profit take", "Trailing stop", "TP hit"]) : rng.pick(["SL hit", "SL hit", "Manual invalidation", "Panic close"]);

    await db.insert(s.tradeJournal).values({
      tradeId: t.id,
      strategyId: rng.pick(vocab.strategy).id,
      stopLoss: Number(plan.stopLoss.toPrecision(6)),
      takeProfit: Number(plan.takeProfit.toPrecision(6)),
      session: t.entryTime ? sessionFor(t.entryTime, opts.sessions) : null,
      tradeType: rng.chance(0.7) ? "planned" : "reactive",
      entryTimeframe: entryTf,
      timeframeClass: tfClass,
      marketCondition: rng.pick(s.MARKET_CONDITIONS),
      htfTimeframes: rng.sample(["1H", "4H", "1D", "1W"], rng.int(1, 3)),
      emotionBeforeId: full ? rng.pick(vocab.emotion).id : null,
      grade,
      entryRetests: rng.int(0, 3),
      maxRReached: win ? Math.max(plan.targetR ?? 1, 1) + rng.pick([0, 0.5, 1]) : rng.pick([0, 0, 0.5, 1]),
      riskMultiplier: rng.pick([null, null, 0.5, 1, 1.5]),
      rationale: rng.pick(RATIONALES),
      postNotes: full && t.status === "closed" ? rng.pick(win ? POST_NOTES_WIN : POST_NOTES_LOSS) : null,
      rulesFollowed: full ? rulesFollowed : null,
      exitReasonId: full && exitReason ? byLabel("exit_reason", exitReason) : null,
      emotionAfterId: full && t.status === "closed" ? rng.pick(vocab.emotion).id : null,
      processCompliant: full ? rulesFollowed === "yes" : null,
      reviewedAt: full && t.exitTime ? t.exitTime + rng.int(1, 48) * 3_600_000 : null,
    });

    const links: { itemId: string; kind: s.VocabKind }[] = [];
    for (const c of rng.sample(vocab.confluence, rng.int(2, 5))) links.push({ itemId: c.id, kind: "confluence" });
    links.push({ itemId: rng.pick(vocab.sl_reason).id, kind: "sl_reason" });
    links.push({ itemId: rng.pick(vocab.tp_reason).id, kind: "tp_reason" });
    for (const c of vocab.checklist) if (rng.chance(win ? 0.9 : 0.7)) links.push({ itemId: c.id, kind: "checklist" });
    if (!win && rulesFollowed !== "yes") {
      for (const m of rng.sample(vocab.mistake, rng.int(1, 2))) links.push({ itemId: m.id, kind: "mistake" });
    }
    await db.insert(s.tradeVocab).values(links.map((l) => ({ tradeId: t.id, ...l })));

    const tags = rng.sample(TAGS, rng.int(0, 2));
    if (tags.length) await db.insert(s.tradeTags).values(tags.map((n) => ({ tradeId: t.id, tagId: tagIds.get(n)! })));
  }
  return { journaled, total: trades.length };
}
