import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.join(__dirname, "../drizzle/0011_pair_label.sql"), "utf8")
  .split("\n")
  .filter((l) => !l.startsWith("--"))
  .join("\n");

describe("migration 0011: HIP-3 pair labels without a middle dot", () => {
  it("rewrites only HIP-3 labels, and running it twice changes nothing more", async () => {
    const c = createClient({ url: ":memory:" });
    await c.execute("create table trades (id text, market_type text, display_pair text)");
    await c.execute(`insert into trades values
      ('a', 'hip3', 'SPX/USD · xyz'), ('b', 'perp', 'BTC/USD'), ('c', 'spot', 'PURR/USDC'),
      ('d', 'perp', 'ODD · NAME'), ('e', 'hip3', 'TSLA/USD (xyz)')`);
    await c.execute(sql);
    await c.execute(sql);
    const rows = (await c.execute("select id, display_pair from trades order by id")).rows.map((r) => [
      r.id,
      r.display_pair,
    ]);
    expect(rows).toEqual([
      ["a", "SPX/USD (xyz)"],
      ["b", "BTC/USD"],
      ["c", "PURR/USDC"],
      ["d", "ODD · NAME"], // not HIP-3: untouched
      ["e", "TSLA/USD (xyz)"],
    ]);
  });
});
