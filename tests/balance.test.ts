import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import { balanceInputs } from "@/server/db/queries/dashboard";
import * as s from "@/server/db/schema";

const T0 = Date.UTC(2026, 9, 1);
const ADDR_A = "0x" + "a".repeat(40); // synthetic
const ADDR_B = "0x" + "b".repeat(40); // synthetic
let accountId: string;
let otherAccountId: string;
let walletId: string;

const db = () => getDb();
const complete = { ledgerCompletedAt: T0, fundingCompletedAt: T0, backfillCompletedAt: T0 };
const ev = (wId: string, uid: string, usd: number, kind: string) => ({ walletId: wId, uid, time: T0, hash: "0x0", type: "x", delta: { type: "x" }, kind, usd });
let tid = 1;
const fill = (wId: string, extra: Partial<typeof s.fills.$inferInsert> = {}) => ({
  walletId: wId,
  tid: tid++,
  coin: "BTC",
  marketType: "perp" as const,
  px: "100",
  sz: "1",
  side: "A" as const,
  time: T0 + tid,
  startPosition: "1",
  dir: "Close Long",
  closedPnl: "50",
  fee: "2",
  feeToken: "USDC",
  hash: "0x0",
  oid: tid,
  crossed: true,
  raw: {},
  ...extra,
});

beforeAll(async () => {
  useTempDb();
  await runMigrations(db());
  await seedDefaults(db());
  accountId = (await db().select().from(s.accounts))[0].id;
  otherAccountId = (await db().insert(s.accounts).values({ name: "Other" }).returning())[0].id;
});

beforeEach(async () => {
  for (const t of [s.fills, s.fundingEvents, s.ledgerEvents, s.wallets]) await db().delete(t);
  walletId = (await db().insert(s.wallets).values({ accountId, address: ADDR_A, ...complete }).returning())[0].id;
});

describe("balanceInputs", () => {
  test("null until every wallet on the account has full ledger and fill history", async () => {
    await db().insert(s.ledgerEvents).values(ev(walletId, "a", 1_000, "deposit"));
    expect(await balanceInputs(db(), accountId)).not.toBeNull();
    for (const missing of [{ ledgerCompletedAt: null }, { fundingCompletedAt: null }, { backfillCompletedAt: null }, { historyTruncated: true }]) {
      await db().update(s.wallets).set({ ...complete, historyTruncated: false, ...missing }).where(eq(s.wallets.id, walletId));
      expect(await balanceInputs(db(), accountId)).toBeNull();
    }
    // a second wallet whose ledger is still backfilling turns the view off for the whole account
    await db().update(s.wallets).set({ ...complete, historyTruncated: false }).where(eq(s.wallets.id, walletId));
    const [b] = await db().insert(s.wallets).values({ accountId, address: ADDR_B, backfillCompletedAt: T0 }).returning();
    expect(await balanceInputs(db(), accountId)).toBeNull();
    // a disabled wallet is never synced: it neither blocks the view nor adds money
    await db().update(s.wallets).set({ enabled: false }).where(eq(s.wallets.id, b.id));
    await db().insert(s.fills).values(fill(b.id, { closedPnl: "500" }));
    const res = (await balanceInputs(db(), accountId))!;
    expect(res.flows).toHaveLength(1);
    expect(res.cash).toEqual([]);
  });

  test("this account's wallets only; cash = closedPnl − fee per fill + funding; zero-cash ledger rows dropped", async () => {
    const other = (await db().insert(s.wallets).values({ accountId: otherAccountId, address: ADDR_B, ...complete }).returning())[0].id;
    await db().insert(s.ledgerEvents).values([ev(walletId, "a", 1_000, "deposit"), ev(walletId, "b", 0, "no_cash"), ev(other, "c", 9_999, "deposit")]);
    await db().insert(s.fills).values([
      fill(walletId),
      fill(walletId, { closedPnl: "0", fee: "0.5", feeToken: "HYPE", px: "20" }), // fee in a non-stable token: valued at the fill price
      fill(other, { closedPnl: "777" }),
    ]);
    await db().insert(s.fundingEvents).values({ walletId, hash: "0x0", coin: "BTC", time: T0 + 5, usdc: "-3", szi: "1", fundingRate: "0.0001" });
    const res = (await balanceInputs(db(), accountId))!;
    expect(res.flows).toEqual([{ t: T0, usd: 1_000, kind: "deposit" }]);
    expect(res.cash.map((c) => c.usd).sort((a, b) => a - b)).toEqual([-10, -3, 48]);
  });

  test("spot fills count only for unified accounts", async () => {
    await db().insert(s.ledgerEvents).values(ev(walletId, "a", 1_000, "deposit"));
    await db().insert(s.fills).values(fill(walletId, { marketType: "spot", coin: "@1", closedPnl: "10", fee: "1" }));
    expect((await balanceInputs(db(), accountId))!.cash).toEqual([]);
    await db().update(s.wallets).set({ accountMode: "unifiedAccount" }).where(eq(s.wallets.id, walletId));
    expect((await balanceInputs(db(), accountId))!.cash.map((c) => c.usd)).toEqual([9]);
  });
});
