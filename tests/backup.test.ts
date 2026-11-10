import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createClient } from "@libsql/client";
import { assertOutsideRepo, copyDatabase, downloadObjects, makeArchive, snapshotLocalDb } from "@/server/backup";

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

async function sampleDb() {
  const dir = tmp("tj-bk-src-");
  const c = createClient({ url: `file:${path.join(dir, "src.db")}` });
  await c.execute('create table "trades" (id text primary key, net real, note text)');
  await c.execute("create index trades_net_idx on trades(net)");
  await c.execute("create table empty_t (x integer)");
  await c.batch(Array.from({ length: 1234 }, (_, i) => ({ sql: "insert into trades values (?, ?, ?)", args: [`t${i}`, i * 1.5, i % 7 ? null : "it's ok"] })), "write");
  return c;
}

describe("backups", () => {
  test("refuses a backup folder inside the repo", () => {
    expect(() => assertOutsideRepo("/repo/backups", "/repo")).toThrow(/inside the repository/);
    expect(() => assertOutsideRepo("/repo", "/repo")).toThrow();
    expect(() => assertOutsideRepo("/home/me/trading-journal-backups", "/repo")).not.toThrow();
    expect(() => assertOutsideRepo("/repo-backups", "/repo")).not.toThrow();
  });

  test("copyDatabase copies schema, indexes and every row across pages", async () => {
    const src = await sampleDb();
    const out = path.join(tmp("tj-bk-out-"), "copy.db");
    const counts = await copyDatabase(src, out, 500);
    expect(counts).toEqual({ empty_t: 0, trades: 1234 });
    const copy = createClient({ url: `file:${out}` });
    const r = await copy.execute("select count(*) n, sum(net) s from trades");
    expect(Number(r.rows[0].n)).toBe(1234);
    expect(Number(r.rows[0].s)).toBeCloseTo(((1233 * 1234) / 2) * 1.5, 6);
    expect((await copy.execute("select note from trades where id = 't0'")).rows[0].note).toBe("it's ok");
    expect((await copy.execute("select name from sqlite_master where type='index' and name='trades_net_idx'")).rows).toHaveLength(1);
    await expect(copyDatabase(src, out)).rejects.toThrow(/already exists/);
  });

  test("local snapshot + archive round-trips", async () => {
    const src = await sampleDb();
    const staging = tmp("tj-bk-stage-");
    await snapshotLocalDb(src, path.join(staging, "journal.db"));
    fs.mkdirSync(path.join(staging, "uploads/screenshots/t1"), { recursive: true });
    fs.writeFileSync(path.join(staging, "uploads/screenshots/t1/a.webp"), "x");
    const out = path.join(tmp("tj-bk-arch-"), "b.tar.gz");
    expect(makeArchive(staging, out)).toBeGreaterThan(0);
    expect(fs.existsSync(staging)).toBe(false);
    expect(fs.statSync(out).mode & 0o777).toBe(0o600);
    const listing = execFileSync("tar", ["-tzf", out], { encoding: "utf8" });
    expect(listing).toContain("./journal.db");
    expect(listing).toContain("./uploads/screenshots/t1/a.webp");
  });

  test("downloadObjects pages through the bucket and blocks path traversal", async () => {
    const objects: Record<string, string> = { "screenshots/t1/a.webp": "A", "screenshots/t2/b.png": "B", "screenshots/t2/c.jpg": "C" };
    const keys = Object.keys(objects);
    const dest = tmp("tj-bk-dl-");
    const n = await downloadObjects(
      {
        list: async (token) => (token ? { keys: keys.slice(2) } : { keys: keys.slice(0, 2), next: "page2" }),
        get: async (k) => new TextEncoder().encode(objects[k]),
      },
      dest,
    );
    expect(n).toBe(3);
    expect(fs.readFileSync(path.join(dest, "screenshots/t2/c.jpg"), "utf8")).toBe("C");
    await expect(
      downloadObjects({ list: async () => ({ keys: ["../../etc/x.png"] }), get: async () => new Uint8Array() }, tmp("tj-bk-bad-")),
    ).rejects.toThrow(/Unsafe object key/);
  });
});
