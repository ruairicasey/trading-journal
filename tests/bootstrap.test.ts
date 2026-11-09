import { beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { SEED_VOCAB } from "@/server/db/seed-data";

describe("db bootstrap", () => {
  beforeAll(async () => {
    useTempDb();
    await runMigrations(getDb());
  });

  test("seeds defaults once and is idempotent", async () => {
    const db = getDb();
    expect((await seedDefaults(db)).seeded).toBe(true);
    expect((await seedDefaults(db)).seeded).toBe(false);
    await runMigrations(db); // re-running migrations is a no-op

    const accounts = await db.select().from(s.accounts);
    expect(accounts).toHaveLength(1);
    const checklist = await db.select().from(s.vocabItems).where(eq(s.vocabItems.kind, "checklist"));
    expect(checklist.map((c) => c.label)).toEqual(SEED_VOCAB.checklist[0].items);
    const tz = await db.query.settings.findFirst({ where: eq(s.settings.key, "timezone") });
    expect(tz?.value).toBe("Australia/Melbourne");
  });

  test("deleted vocab is never re-added by a later seed", async () => {
    const db = getDb();
    await db.delete(s.vocabItems).where(eq(s.vocabItems.kind, "emotion"));
    await seedDefaults(db);
    expect(await db.select().from(s.vocabItems).where(eq(s.vocabItems.kind, "emotion"))).toHaveLength(0);
  });

  test("seed never creates a wallet unless HL_WALLET_ADDRESS is set", async () => {
    expect(await getDb().select().from(s.wallets)).toHaveLength(0);
  });
});
