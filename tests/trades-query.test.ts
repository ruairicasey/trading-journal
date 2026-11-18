import { beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { DEFAULT_SESSIONS } from "@/server/db/seed-data";
import { DEMO_ADDRESS, generateDemoHistory } from "@/server/demo/generate";
import { seedDemoJournal } from "@/server/demo/journal";
import { createRng } from "@/server/demo/rng";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import {
  listNotes,
  listTrades,
  filterOptions,
  matchingTradeIds,
  missingCounts,
} from "@/server/db/queries/trades";
import { MISSING_KINDS } from "@/lib/missing";
import { analyticsTrades } from "@/server/db/queries/analytics";
import { weekOf } from "@/lib/weekly";
import { parseFilters, tradesHref, toggleChipHref, CHIPS, type TradeFilters } from "@/server/trades/filters";
import { createNote, duplicateAsPlanned, restoreTrade, softDeleteTrade } from "@/server/trades/mutations";
import { outcomeOf, rMultiple } from "@/lib/outcome";

const TZ = "Australia/Melbourne";
const END = Date.UTC(2026, 10, 9, 12);
let accountId: string;
let walletId: string;
const f = (p: Record<string, string> = {}): TradeFilters => parseFilters(p);
const list = (p: Record<string, string> = {}) => listTrades(getDb(), accountId, f(p), { tz: TZ, now: END });
const allRows = async (p: Record<string, string> = {}) => {
  const out = [];
  for (let page = 1; ; page++) {
    const r = await list({ ...p, page: String(page) });
    out.push(...r.rows);
    if (out.length >= r.total || r.rows.length === 0) return { rows: out, total: r.total, counts: r.counts };
  }
};

beforeAll(async () => {
  useTempDb();
  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db);
  accountId = (await db.select().from(s.accounts))[0].id;
  const [w] = await db.insert(s.wallets).values({ accountId, address: DEMO_ADDRESS }).returning();
  walletId = w.id;
  const h = generateDemoHistory({ end: END });
  await insertFills(db, walletId, h.fills);
  await rebuildTrades(db, { walletId, accountId });
  await seedDemoJournal(db, createRng(7), { walletId, plans: h.plans, sessions: DEFAULT_SESSIONS });
});

describe("tabs, counts and pagination", () => {
  test("counts add up and match the stored trades", async () => {
    const r = await list();
    const stored = await getDb().select().from(s.trades);
    expect(r.counts.all).toBe(stored.length);
    expect(r.counts.all).toBe(r.counts.planned + r.counts.open + r.counts.closed);
    expect(r.counts.open).toBeGreaterThanOrEqual(2);
    expect(r.total).toBe(r.counts.all);
    expect(r.rows).toHaveLength(20);
    expect((await list({ tab: "open" })).total).toBe(r.counts.open);
    expect((await list({ tab: "closed" })).rows.every((x) => x.status === "closed")).toBe(true);
  });

  test("pages don't overlap and are newest first", async () => {
    const p1 = await list();
    const p2 = await list({ page: "2" });
    expect(new Set([...p1.rows, ...p2.rows].map((x) => x.id)).size).toBe(40);
    const times = [...p1.rows, ...p2.rows].map((x) => x.entryTime!);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

describe("filters", () => {
  test("outcome partitions closed trades using the shared BE band", async () => {
    const closed = (await allRows({ tab: "closed" })).rows;
    const [w, l, b] = await Promise.all([
      allRows({ outcome: "win" }),
      allRows({ outcome: "loss" }),
      allRows({ outcome: "be" }),
    ]);
    expect(w.total + l.total + b.total).toBe(closed.length);
    for (const r of w.rows) expect(outcomeOf(r.netPnl, r.notionalUsd)).toBe("win");
    for (const r of l.rows) expect(outcomeOf(r.netPnl, r.notionalUsd)).toBe("loss");
    expect(w.counts.open).toBe(0); // outcome filters apply to closed trades only
  });

  test("R filters only match trades with a stop, using the same formula as the UI", async () => {
    const all = (await allRows()).rows;
    for (const r of all) {
      const js = rMultiple(r);
      if (js === null) expect(r.r).toBeNull();
      else expect(r.r).toBeCloseTo(js, 9);
    }
    const ge1 = (await allRows({ minR: "1" })).rows;
    expect(ge1.length).toBeGreaterThan(0);
    expect(ge1.every((r) => r.stopLoss !== null && r.r! >= 1)).toBe(true);
    const band = (await allRows({ minR: "-1.05", maxR: "-0.95" })).rows;
    expect(band.every((r) => r.r! >= -1.05 && r.r! <= -0.95)).toBe(true);
  });

  test("pair, direction, grade and strategy", async () => {
    const btc = (await allRows({ pair: "BTC" })).rows;
    expect(btc.length).toBeGreaterThan(0);
    expect(btc.every((r) => r.coin === "BTC")).toBe(true);
    const shorts = (await allRows({ dir: "short" })).rows;
    expect(shorts.every((r) => r.direction === "short")).toBe(true);
    const aPlus = (await allRows({ grade: "A+" })).rows;
    expect(aPlus.every((r) => r.grade === "A+")).toBe(true);
    const opts = await filterOptions(getDb(), accountId);
    expect(opts.pairs.map((p) => p.coin)).toContain("xyz:SPX");
    const strat = opts.strategies[0];
    const byStrat = (await allRows({ strategy: strat.id })).rows;
    expect(byStrat.every((r) => r.strategyLabel === strat.label)).toBe(true);
  });

  test("date range uses Melbourne days, across the October DST change", async () => {
    const db = getDb();
    // Melbourne DST starts 2026-10-04 02:00 (UTC+10 → UTC+11).
    const mk = async (iso: string) => {
      const [row] = await db
        .insert(s.trades)
        .values({
          accountId,
          source: "manual",
          coin: "DSTTEST",
          displayPair: "DSTTEST/USD",
          direction: "long",
          status: "closed",
          entryTime: Date.parse(iso),
          netPnl: 1,
          flags: {},
        })
        .returning({ id: s.trades.id });
      return row.id;
    };
    const early = await mk("2026-10-03T14:30:00Z"); // 4 Oct 00:30 AEST
    const late = await mk("2026-10-04T12:30:00Z"); // 4 Oct 23:30 AEDT
    const next = await mk("2026-10-04T13:10:00Z"); // 5 Oct 00:10 AEDT
    const before = await mk("2026-10-03T13:50:00Z"); // 3 Oct 23:50 AEST
    const ids = (await allRows({ pair: "DSTTEST", from: "2026-10-04", to: "2026-10-04" })).rows.map(
      (r) => r.id,
    );
    expect(ids.sort()).toEqual([early, late].sort());
    expect(ids).not.toContain(next);
    expect(ids).not.toContain(before);
    // dateBy=exit filters on the exit day instead (P&L calendar links)
    await db
      .update(s.trades)
      .set({ exitTime: Date.parse("2026-10-05T01:00:00Z") })
      .where(eq(s.trades.id, early)); // exits 5 Oct
    const byExit = (
      await allRows({ pair: "DSTTEST", from: "2026-10-05", to: "2026-10-05", dateBy: "exit" })
    ).rows.map((r) => r.id);
    expect(byExit).toEqual([early]);
    for (const id of [early, late, next, before]) await softDeleteTrade(db, accountId, id);
  });

  test("search covers pair, tag, rationale and strategy; LIKE wildcards are literal", async () => {
    expect(
      (await allRows({ q: "spx" })).rows.every((r) => r.coin === "xyz:SPX" || /spx/i.test(r.rationale ?? "")),
    ).toBe(true);
    expect((await allRows({ q: "spx" })).total).toBeGreaterThan(0);
    const tagged = (await allRows({ q: "a-setup" })).rows;
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged.every((r) => r.tags.includes("a-setup") || /a-setup/i.test(r.rationale ?? ""))).toBe(true);
    expect((await allRows({ q: "anchored VWAP" })).total).toBeGreaterThan(0); // rationale text
    // "%" and "_" are literal: as LIKE wildcards "x%y" would match "xyz:SPX" and "x_z" would too
    expect((await list({ q: "x%y" })).total).toBe(0);
    expect((await list({ q: "x_z" })).total).toBe(0);
    expect((await list({ q: "_" })).total).toBe(0);
  });

  test("full text: every term must match (any field), quoted phrases stay together", async () => {
    const db = getDb();
    const [a, b, c, d] = (await allRows({ tab: "closed" })).rows;
    const before = await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, a.id) });
    const beforeD = await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, d.id) });
    const lesson = { lesson: "Waited for the Retest like planned" };
    await db
      .insert(s.tradeJournal)
      .values({ tradeId: a.id, reflection: lesson })
      .onConflictDoUpdate({ target: s.tradeJournal.tradeId, set: { reflection: lesson } });
    await db
      .insert(s.screenshots)
      .values({ tradeId: b.id, storageKey: "x", caption: "Zebra wick at the open" });
    const [mv] = await db
      .insert(s.stopMoves)
      .values({ tradeId: c.id, time: 1, price: 1, note: "Quokka trail" })
      .returning();
    try {
      expect((await allRows({ q: "retest planned" })).rows.map((r) => r.id)).toContain(a.id); // reflection text
      expect((await allRows({ q: '"retest like planned"' })).rows.map((r) => r.id)).toEqual([a.id]);
      expect((await allRows({ q: '"planned like retest"' })).total).toBe(0); // phrase order matters
      expect((await allRows({ q: "zebra" })).rows.map((r) => r.id)).toEqual([b.id]); // screenshot caption
      expect((await allRows({ q: `zebra ${b.displayPair}` })).rows.map((r) => r.id)).toEqual([b.id]); // AND across fields
      expect((await allRows({ q: "zebra retest" })).total).toBe(0); // AND: no trade has both
      expect((await allRows({ q: "quokka" })).rows.map((r) => r.id)).toEqual([c.id]); // stop-move note

      // the list, its counts and "select all matching" agree for a multi-term query
      for (const q of ['zebra "wick at"', "retest planned", `quokka ${c.displayPair}`]) {
        const r = await list({ q });
        const ids = await matchingTradeIds(db, accountId, f({ q }), { tz: TZ, now: END, limit: 10_000 });
        expect(ids.length, q).toBe(r.total);
        expect(r.counts.all, q).toBe(r.total);
      }

      // a quoted phrase of a vocab label: the confluence "80% rule (VA rotation)", literal % included
      const withRule = (await allRows({ q: '"80% rule (va rotation)"' })).rows;
      const ruleIds = (
        await db
          .select({ id: s.tradeVocab.tradeId })
          .from(s.tradeVocab)
          .innerJoin(s.vocabItems, eq(s.vocabItems.id, s.tradeVocab.itemId))
          .where(eq(s.vocabItems.label, "80% rule (VA rotation)"))
      ).map((r) => r.id);
      const live = new Set((await allRows({})).rows.map((r) => r.id));
      expect(ruleIds.length).toBeGreaterThan(0);
      expect(withRule.map((r) => r.id).sort()).toEqual(
        [...new Set(ruleIds)].filter((id) => live.has(id)).sort(),
      );

      // exit reason and emotions (journal ids → vocab labels), and the session
      const [exitItem] = await db
        .select()
        .from(s.vocabItems)
        .where(eq(s.vocabItems.kind, "exit_reason"))
        .limit(1);
      const [emo] = await db.select().from(s.vocabItems).where(eq(s.vocabItems.kind, "emotion")).limit(1);
      const exitRows = (await allRows({ q: `"${exitItem.label.toLowerCase()}"` })).rows.map((r) => r.id);
      const withExit = (
        await db
          .select({ id: s.tradeJournal.tradeId })
          .from(s.tradeJournal)
          .where(eq(s.tradeJournal.exitReasonId, exitItem.id))
      ).map((r) => r.id);
      for (const id of withExit.filter((x) => live.has(x))) expect(exitRows).toContain(id);
      await db
        .insert(s.tradeJournal)
        .values({ tradeId: d.id, emotionBeforeId: emo.id, session: "Kangaroo hours" })
        .onConflictDoUpdate({
          target: s.tradeJournal.tradeId,
          set: { emotionBeforeId: emo.id, session: "Kangaroo hours" },
        });
      expect((await allRows({ q: "kangaroo" })).rows.map((r) => r.id)).toEqual([d.id]);
      expect((await allRows({ q: `kangaroo "${emo.label.toLowerCase()}"` })).rows.map((r) => r.id)).toEqual([
        d.id,
      ]);
    } finally {
      await db.delete(s.screenshots).where(eq(s.screenshots.tradeId, b.id));
      await db.delete(s.stopMoves).where(eq(s.stopMoves.id, mv.id));
      if (before)
        await db
          .update(s.tradeJournal)
          .set({ reflection: before.reflection })
          .where(eq(s.tradeJournal.tradeId, a.id));
      else await db.delete(s.tradeJournal).where(eq(s.tradeJournal.tradeId, a.id));
      if (beforeD)
        await db
          .update(s.tradeJournal)
          .set({ emotionBeforeId: beforeD.emotionBeforeId, session: beforeD.session })
          .where(eq(s.tradeJournal.tradeId, d.id));
      else await db.delete(s.tradeJournal).where(eq(s.tradeJournal.tradeId, d.id));
    }
  });

  test("full text: a trade with no journal row still matches on its pair, and json_each(NULL) is harmless", async () => {
    const db = getDb();
    const [w] = await db.select().from(s.wallets).limit(1);
    const [t] = await db
      .insert(s.trades)
      .values({
        accountId,
        walletId: w.id,
        source: "manual",
        coin: "WOMBAT",
        displayPair: "WOMBAT-USD",
        direction: "long",
        status: "planned",
        flags: {},
      })
      .returning();
    try {
      expect((await allRows({ q: "wombat" })).rows.map((r) => r.id)).toEqual([t.id]);
      expect((await allRows({ q: "wombat lesson" })).total).toBe(0);
    } finally {
      await db.delete(s.trades).where(eq(s.trades.id, t.id));
    }
  });

  test("invalid params are ignored rather than erroring", async () => {
    const x = f({ tab: "nope", outcome: "maybe", minR: "abc", from: "2026-13-99x", page: "-3", grade: "Z" });
    expect(x).toMatchObject({ tab: "all", page: 1 });
    expect(x.outcome ?? x.minR ?? x.from ?? x.grade).toBeUndefined();
  });

  test("URL helpers keep filters, reset paging and toggle chips", () => {
    const cur = f({ tab: "closed", dir: "long", page: "3" });
    expect(tradesHref(cur, { outcome: "win" })).toBe("/trades?tab=closed&dir=long&outcome=win");
    expect(tradesHref(cur, { page: 4 })).toBe("/trades?tab=closed&dir=long&page=4");
    const winners = CHIPS.find((c) => c.id === "winners")!;
    const on = toggleChipHref(f({}), winners);
    expect(on).toBe("/trades?outcome=win&period=30d");
    expect(toggleChipHref(f({ outcome: "win", period: "30d" }), winners)).toBe("/trades");
  });
});

describe("missing context (weekly reflection)", () => {
  test("each weekly count equals the number of trades its link shows, for several weeks", async () => {
    const db = getDb();
    let checked = 0;
    for (const day of ["2026-11-02", "2026-10-05", "2026-09-14", "2026-08-03"]) {
      const w = weekOf(day, END, TZ);
      const counts = await missingCounts(db, accountId, w.start, w.end);
      const closedInWeek = await allRows({ tab: "closed", from: w.monday, to: w.sunday, dateBy: "exit" });
      expect(counts.total).toBe(closedInWeek.total);
      for (const kind of MISSING_KINDS) {
        const r = await allRows({
          tab: "closed",
          from: w.monday,
          to: w.sunday,
          dateBy: "exit",
          missing: kind,
        });
        expect({ kind, n: r.total }).toEqual({ kind, n: counts[kind] });
        checked += counts[kind];
      }
    }
    expect(checked).toBeGreaterThan(0); // the demo journal leaves gaps on purpose
  });

  test("definitions: unjournaled trades miss everything except the rules-based mistakes check", async () => {
    const db = getDb();
    const all = await missingCounts(db, accountId, 0, Number.MAX_SAFE_INTEGER);
    const closed = await db.select().from(s.trades).where(eq(s.trades.status, "closed"));
    const journaled = new Set((await db.select().from(s.tradeJournal)).map((j) => j.tradeId));
    const blank = closed.filter((t) => !journaled.has(t.id) && !t.deletedAt && !t.flags?.superseded).length;
    expect(all.review).toBeGreaterThanOrEqual(blank);
    expect(all.stop).toBeGreaterThanOrEqual(blank);
    const mistakes = await allRows({ missing: "mistakes" });
    for (const row of mistakes.rows) expect(row.status).toBe("closed");
  });
});

describe("analytics query", () => {
  test("closed live trades only, with confluences, grade, strategy and HTFs from the journal", async () => {
    const db = getDb();
    const rows = await analyticsTrades(db, accountId);
    const closed = await allRows({ tab: "closed" });
    expect(rows.length).toBe(closed.total);
    const links = await db.select().from(s.tradeVocab).where(eq(s.tradeVocab.kind, "confluence"));
    const live = new Set(rows.map((r) => r.id));
    expect(rows.reduce((a, r) => a + r.confluences.length, 0)).toBe(
      links.filter((l) => live.has(l.tradeId)).length,
    );
    expect(rows.some((r) => r.grade && r.strategy && r.htf.length)).toBe(true);
    expect(rows.every((r, i) => i === 0 || r.exitTime >= rows[i - 1].exitTime)).toBe(true);
  });
});

describe("mutations", () => {
  test("delete hides a trade (counts too), restore brings it back, rebuild never resurrects", async () => {
    const db = getDb();
    const before = await list();
    const victim = before.rows[0];
    expect(await softDeleteTrade(db, accountId, victim.id)).toBe(true);
    const after = await list();
    expect(after.counts.all).toBe(before.counts.all - 1);
    expect(after.rows.map((r) => r.id)).not.toContain(victim.id);
    await rebuildTrades(db, { walletId, accountId });
    expect((await list()).counts.all).toBe(before.counts.all - 1);
    expect(await restoreTrade(db, accountId, victim.id)).toBe(true);
    expect((await list()).counts.all).toBe(before.counts.all);
  });

  test("duplicate creates a manual planned trade with the setup only", async () => {
    const db = getDb();
    const src = (await allRows({ tab: "closed" })).rows.find((r) => r.stopLoss !== null && r.grade !== null)!;
    const newId = (await duplicateAsPlanned(db, accountId, src.id))!;
    const planned = await list({ tab: "planned" });
    expect(planned.rows.map((r) => r.id)).toContain(newId);
    const copy = planned.rows.find((r) => r.id === newId)!;
    expect(copy).toMatchObject({
      source: "manual",
      status: "planned",
      coin: src.coin,
      direction: src.direction,
      stopLoss: src.stopLoss,
    });
    expect(copy.grade).toBeNull(); // review fields are not copied
    expect(copy.netPnl).toBeNull();
    const journal = await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, newId) });
    expect(journal?.rationale).toBeNull();
    expect(journal?.manualEntry).toBe(src.avgEntry);
    const kinds = (await db.select().from(s.tradeVocab).where(eq(s.tradeVocab.tradeId, newId))).map(
      (v) => v.kind,
    );
    expect(kinds.every((k) => ["confluence", "sl_reason", "tp_reason"].includes(k))).toBe(true);
    expect(await duplicateAsPlanned(db, "other-account", src.id)).toBeNull();
  });

  test("notes are searchable and paginated", async () => {
    const db = getDb();
    await createNote(db, accountId, {
      title: "Weekly review",
      body: "Too many reactive entries in Asia.",
      date: END,
    });
    await createNote(db, accountId, {
      title: null,
      body: "FOMC next week, size down.",
      date: END - 86_400_000,
    });
    expect((await listNotes(db, accountId, { page: 1 })).total).toBe(2);
    const hit = await listNotes(db, accountId, { q: "fomc", page: 1 });
    // every term must be in the note (title or body); unknown terms rule it out
    expect((await listNotes(db, accountId, { q: "fomc zzzqqq", page: 1 })).total).toBe(0);
    expect(hit.rows.map((r) => r.body)).toEqual(["FOMC next week, size down."]);
  });
});
