import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { createManualTrade, normaliseCoin, type ManualTradeInput } from "@/server/trades/manual";
import { loadTradeForEdit, saveTradeBasic } from "@/server/trades/journal";
import { initialDraft, protectionBase, toPayload } from "@/components/trade-form/types";

let accountId: string;
let prop: string;
const NOW = Date.UTC(2026, 10, 20, 0, 0);
const H = 3_600_000;

beforeAll(async () => {
  useTempDb();
  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db);
  accountId = (await db.select().from(s.accounts))[0].id;
  [{ id: prop }] = await db
    .insert(s.accounts)
    .values({ name: "Prop", type: "prop" })
    .returning({ id: s.accounts.id });
});
beforeEach(async () => {
  const db = getDb();
  for (const t of [s.tradeVocab, s.tradeJournal, s.trades]) await db.delete(t);
});

const closed = (over: Partial<ManualTradeInput> = {}): ManualTradeInput => ({
  coin: "eth",
  direction: "long",
  status: "closed",
  entry: 3000,
  exit: 3060,
  size: 2,
  fees: 4.5,
  stopLoss: 2970,
  entryTime: NOW - 5 * H,
  exitTime: NOW - 2 * H,
  ...over,
});

describe("manual trade entry", () => {
  test("a closed trade gets its figures from what was entered", async () => {
    const db = getDb();
    const res = await createManualTrade(db, accountId, closed(), NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = (await db.select().from(s.trades).where(eq(s.trades.id, res.id)))[0];
    expect(t).toMatchObject({
      source: "manual",
      coin: "ETH",
      displayPair: "ETH/USD",
      status: "closed",
      direction: "long",
      walletId: null,
      grossPnl: 120,
      fees: 4.5,
      netPnl: 115.5,
      durationMs: 3 * H,
      notionalUsd: 6000,
    });
    const edit = (await loadTradeForEdit(db, accountId, res.id))!;
    expect(edit.journal).toMatchObject({
      stopLoss: 2970,
      stopLossSource: "user",
      manualEntry: 3000,
      manualExit: 3060,
    });
    expect(edit.journal?.reviewedAt).toBeNull();
  });

  test("a short's P&L has the right sign", async () => {
    const res = await createManualTrade(
      getDb(),
      accountId,
      closed({ direction: "short", stopLoss: 3100 }),
      NOW,
    );
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    const t = (await getDb().select().from(s.trades).where(eq(s.trades.id, res.id)))[0];
    expect(t.netPnl).toBe(-124.5);
  });

  test("open and planned trades leave exit figures empty", async () => {
    const db = getDb();
    const open = await createManualTrade(db, accountId, closed({ status: "open" }), NOW);
    const plan = await createManualTrade(db, accountId, closed({ status: "planned", entryTime: null }), NOW);
    if (!open.ok || !plan.ok) throw new Error("not created");
    const [o] = await db.select().from(s.trades).where(eq(s.trades.id, open.id));
    expect(o).toMatchObject({ status: "open", avgExit: null, exitTime: null, netPnl: null });
    const [p] = await db.select().from(s.trades).where(eq(s.trades.id, plan.id));
    expect(p).toMatchObject({ status: "planned", entryTime: null, exitTime: null, netPnl: null });
  });

  test("rejects incomplete or inconsistent input", async () => {
    const db = getDb();
    const bad = async (over: Partial<ManualTradeInput>) => {
      const r = await createManualTrade(db, accountId, closed(over), NOW);
      return r.ok ? null : r.errors;
    };
    expect(await bad({ exit: null })).toHaveProperty("exit");
    expect(await bad({ size: null })).toHaveProperty("size");
    expect(await bad({ exitTime: NOW - 6 * H })).toHaveProperty("exitTime");
    expect(await bad({ stopLoss: 3010 })).toHaveProperty("stopLoss");
    expect(await bad({ entryTime: NOW + 2 * H, exitTime: NOW + 3 * H })).toHaveProperty("entryTime");
    expect(await bad({ coin: "" })).toHaveProperty("form");
    expect(await bad({ entry: -1 })).toHaveProperty("form");
    expect(await db.select().from(s.trades)).toHaveLength(0);
  });

  test("an unknown account creates nothing", async () => {
    const r = await createManualTrade(getDb(), "nope", closed(), NOW);
    expect(r.ok).toBe(false);
  });

  test("a pair that normalises to nothing usable is rejected", async () => {
    for (const coin of ["/USD", "-perp", "BTC:", ":BTC", "BT C$"]) {
      const r = await createManualTrade(getDb(), accountId, closed({ coin }), NOW);
      expect(r.ok, coin).toBe(false);
    }
    expect(await getDb().select().from(s.trades)).toHaveLength(0);
  });

  test("prop accounts store cTrader-style CFD symbols", async () => {
    const db = getDb();
    const res = await createManualTrade(
      db,
      prop,
      closed({ coin: "eur/usd", entry: 1.1, exit: 1.101, size: 100_000, stopLoss: 1.09, fees: 0 }),
      NOW,
    );
    if (!res.ok) throw new Error(JSON.stringify(res.errors));
    const [t] = await db.select().from(s.trades).where(eq(s.trades.id, res.id));
    expect(t).toMatchObject({ coin: "EURUSD", displayPair: "EURUSD", marketType: "cfd", dex: "" });
    expect(t.netPnl).toBeCloseTo(100, 6);
  });

  test.each(["closed", "open", "planned"] as const)(
    "a new %s trade saved unchanged from the edit form keeps every figure",
    async (status) => {
      const db = getDb();
      for (const [acct, coin] of [
        [accountId, "kPEPE"],
        [prop, "XAUUSD"],
      ] as const) {
        const res = await createManualTrade(
          db,
          acct,
          closed({ coin, status, entryTime: status === "planned" ? null : NOW - 5 * H }),
          NOW,
        );
        if (!res.ok) throw new Error(JSON.stringify(res.errors));
        const row = async () => {
          const [t] = await db.select().from(s.trades).where(eq(s.trades.id, res.id));
          const j = await db.query.tradeJournal.findFirst({ where: eq(s.tradeJournal.tradeId, res.id) });
          return { trade: { ...t, createdAt: 0 }, journal: { ...j!, updatedAt: 0 } };
        };
        const before = await row();
        const draft = initialDraft((await loadTradeForEdit(db, acct, res.id))!);
        const { input } = toPayload(draft);
        expect(await saveTradeBasic(db, acct, res.id, input, protectionBase(draft))).toMatchObject({
          ok: true,
        });
        expect(await row()).toEqual(before);
      }
    },
  );

  test("an existing manual trade with a pair outside today's rules still saves, unchanged", async () => {
    const db = getDb();
    const res = await createManualTrade(db, accountId, closed(), NOW);
    if (!res.ok) throw new Error("not created");
    await db
      .update(s.trades)
      .set({ coin: "BTC-USDC", displayPair: "BTC-USDC" })
      .where(eq(s.trades.id, res.id));
    const draft = initialDraft((await loadTradeForEdit(db, accountId, res.id))!);
    const { input } = toPayload({ ...draft, notes: { ...draft.notes, postNotes: "still saves" } });
    expect(await saveTradeBasic(db, accountId, res.id, input, protectionBase(draft))).toMatchObject({
      ok: true,
    });
    const [t] = await db.select().from(s.trades).where(eq(s.trades.id, res.id));
    expect(t).toMatchObject({ coin: "BTC-USDC", displayPair: "BTC-USDC" });
  });

  test("reuses the account's own spelling of a market; mixed-case broker symbols are kept", async () => {
    const db = getDb();
    const a = await createManualTrade(
      db,
      prop,
      closed({ coin: "US30.cash", entry: 40000, exit: 40100, stopLoss: 39900, size: 1 }),
      NOW,
    );
    const b = await createManualTrade(
      db,
      prop,
      closed({ coin: "us30.CASH", entry: 40000, exit: 40100, stopLoss: 39900, size: 1 }),
      NOW,
    );
    const c = await createManualTrade(
      db,
      prop,
      closed({ coin: "xauusd", entry: 2000, exit: 2010, stopLoss: 1990, size: 1 }),
      NOW,
    );
    if (!a.ok || !b.ok || !c.ok) throw new Error("not created");
    const coin = async (id: string) => (await db.select().from(s.trades).where(eq(s.trades.id, id)))[0].coin;
    expect(await coin(a.id)).toBe("US30.cash");
    expect(await coin(b.id)).toBe("US30.cash");
    expect(await coin(c.id)).toBe("XAUUSD");
    // and on a crypto account, a later "KPEPE" joins an existing kPEPE
    const k1 = await createManualTrade(
      db,
      accountId,
      closed({ coin: "kPEPE", entry: 0.01, exit: 0.011, stopLoss: 0.009 }),
      NOW,
    );
    const k2 = await createManualTrade(
      db,
      accountId,
      closed({ coin: "KPEPE", entry: 0.01, exit: 0.011, stopLoss: 0.009 }),
      NOW,
    );
    if (!k1.ok || !k2.ok) throw new Error("not created");
    expect(await coin(k2.id)).toBe("kPEPE");
  });

  test("pair normalisation", () => {
    expect(normaliseCoin(" btc ")).toBe("BTC");
    expect(normaliseCoin("BTC/USD")).toBe("BTC");
    expect(normaliseCoin("sol-perp")).toBe("SOL");
    expect(normaliseCoin("XYZ:spx")).toBe("xyz:SPX");
    expect(normaliseCoin("kPEPE")).toBe("kPEPE");
    expect(normaliseCoin("kas")).toBe("KAS");
    expect(normaliseCoin("purr/usdc")).toBe("PURR/USDC");
    expect(normaliseCoin("flx:kPEPE")).toBe("flx:kPEPE");
    expect(normaliseCoin("@107")).toBe("@107");
  });
});
