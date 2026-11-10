/**
 * Backups of private data. Used by scripts/backup.ts (`npm run backup`, `npm run backup -- --remote`).
 * Archives are written OUTSIDE the repo only, with owner-only permissions.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

export function assertOutsideRepo(dir: string, repoRoot: string) {
  const rel = path.relative(path.resolve(repoRoot), path.resolve(dir));
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    throw new Error(`Refusing to write backups inside the repository (${dir}). Set BACKUP_DIR to a folder outside it.`);
  }
}

export function timestamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Consistent copy of a local SQLite/libsql file DB (safe while the app is running). */
export async function snapshotLocalDb(src: Client, destFile: string) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  await src.execute({ sql: "VACUUM INTO ?", args: [destFile] });
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Copy a whole database (e.g. Turso over libsql://) into a new local SQLite file: schema first, then rows
 * in pages. Returns row counts per table.
 */
export async function copyDatabase(src: Client, destFile: string, pageSize = 500): Promise<Record<string, number>> {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  if (fs.existsSync(destFile)) throw new Error(`${destFile} already exists`);
  const dest = createClient({ url: `file:${destFile}` });
  try {
    const schema = await src.execute(
      "select type, name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' and name not like '_litestream%' and name not like 'libsql_%' order by case type when 'table' then 0 when 'index' then 1 else 2 end, name",
    );
    const tables: string[] = [];
    for (const r of schema.rows) {
      if (r.type === "table") tables.push(String(r.name));
      if (r.type === "table" || r.type === "index") await dest.execute(String(r.sql));
    }
    const counts: Record<string, number> = {};
    for (const t of tables) {
      counts[t] = 0;
      for (let offset = 0; ; offset += pageSize) {
        const page = await src.execute({ sql: `select * from ${q(t)} limit ? offset ?`, args: [pageSize, offset] });
        if (!page.rows.length) break;
        const cols = page.columns;
        const insert = `insert into ${q(t)} (${cols.map(q).join(", ")}) values (${cols.map(() => "?").join(", ")})`;
        await dest.batch(
          page.rows.map((row) => ({ sql: insert, args: cols.map((_, i) => row[i] as never) })),
          "write",
        );
        counts[t] += page.rows.length;
        if (page.rows.length < pageSize) break;
      }
    }
    return counts;
  } finally {
    dest.close();
  }
}

export type ObjectSource = {
  list: (token?: string) => Promise<{ keys: string[]; next?: string }>;
  get: (key: string) => Promise<Uint8Array>;
};

/** Download every object into destDir/<key>. Keys are sanitised so nothing escapes destDir. */
export async function downloadObjects(src: ObjectSource, destDir: string): Promise<number> {
  const root = path.resolve(destDir);
  let n = 0;
  let token: string | undefined;
  do {
    const page = await src.list(token);
    for (const key of page.keys) {
      const target = path.resolve(root, key);
      if (!target.startsWith(root + path.sep)) throw new Error(`Unsafe object key: ${key}`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await src.get(key));
      n++;
    }
    token = page.next;
  } while (token);
  return n;
}

/** tar.gz the staging folder into outFile (owner-read/write only), then remove the staging folder. */
export function makeArchive(stagingDir: string, outFile: string) {
  execFileSync("tar", ["-czf", outFile, "-C", stagingDir, "."], { stdio: "pipe" });
  fs.chmodSync(outFile, 0o600);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  return fs.statSync(outFile).size;
}
