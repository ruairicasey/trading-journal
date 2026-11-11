import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { getSyncStatus, STALE_AFTER_MS } from "@/server/db/queries/sync";
import { DEMO_WALLET } from "./fixtures/fills";

const HOUR = 3_600_000;
let accountId: string;

beforeAll(async () => {
  useTempDb();
  await runMigrations(getDb());
  await seedDefaults(getDb());
  accountId = (await getDb().select().from(s.accounts))[0].id;
});

beforeEach(async () => {
  await getDb().delete(s.wallets);
});

const wallet = (lastSuccessAt: number | null) =>
  getDb().insert(s.wallets).values({ accountId, address: DEMO_WALLET, lastSuccessAt, lastSyncedAt: lastSuccessAt });

describe("stale-sync warning", () => {
  test("threshold is 6 hours (hourly cron, but GitHub skips runs)", () => {
    expect(STALE_AFTER_MS).toBe(6 * HOUR);
  });

  test("not stale 5h after the last success, stale after 6h, stale if never synced", async () => {
    const now = Date.now();
    await wallet(now - 5 * HOUR);
    expect((await getSyncStatus(now)).stale).toBe(false);
    expect((await getSyncStatus(now + 61 * 60_000)).stale).toBe(true); // 6h01m

    await getDb().delete(s.wallets);
    await wallet(null);
    expect((await getSyncStatus(now)).stale).toBe(true);
  });

  test("no wallets means nothing to warn about", async () => {
    expect((await getSyncStatus()).stale).toBe(false);
  });
});
