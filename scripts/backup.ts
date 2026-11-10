/**
 * npm run backup              — local data: DB snapshot (VACUUM INTO) + screenshots from DATA_DIR/uploads
 * npm run backup -- --remote  — deployed data: full copy of the Turso DB + every object in the R2 bucket
 *
 * Writes trading-journal-<local|remote>-<timestamp>.tar.gz to BACKUP_DIR (default ~/trading-journal-backups),
 * never inside the repo, with owner-only permissions. No credentials are printed.
 *
 * Remote credentials: put DATABASE_URL (libsql://…), DATABASE_AUTH_TOKEN and the R2_* values in
 * `.env.production.local` (gitignored). Local runs read `.env.local` as usual.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

const remote = process.argv.includes("--remote");
// remote → production env files (.env.production.local first); local → development env files
loadEnvConfig(process.cwd(), !remote);

async function main() {
  const { createClient } = await import("@libsql/client");
  const { assertOutsideRepo, copyDatabase, downloadObjects, makeArchive, snapshotLocalDb, timestamp } = await import("../src/server/backup");

  const repo = process.cwd();
  const outDir = path.resolve(process.env.BACKUP_DIR?.trim() || path.join(os.homedir(), "trading-journal-backups"));
  assertOutsideRepo(outDir, repo);
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const stamp = timestamp();
  const staging = path.join(outDir, `.staging-${stamp}`);
  fs.mkdirSync(staging, { recursive: true });

  const dataDir = path.resolve(process.env.DATA_DIR || "./data");
  const dbUrl = process.env.DATABASE_URL?.trim() || `file:${path.join(dataDir, "journal.db")}`;
  try {
    if (!remote) {
      if (!dbUrl.startsWith("file:")) throw new Error("DATABASE_URL is remote. Use `npm run backup -- --remote` for the deployed database.");
      const file = dbUrl.slice("file:".length);
      if (!fs.existsSync(file)) throw new Error(`No local database at ${file}`);
      const db = createClient({ url: dbUrl });
      await snapshotLocalDb(db, path.join(staging, "journal.db"));
      db.close();
      const uploads = path.join(dataDir, "uploads");
      let files = 0;
      if (fs.existsSync(uploads)) {
        fs.cpSync(uploads, path.join(staging, "uploads"), { recursive: true });
        files = fs.readdirSync(path.join(staging, "uploads"), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
      }
      console.log(`Local database snapshot taken; ${files} screenshot file(s) copied.`);
    } else {
      if (!dbUrl.startsWith("libsql://") && !dbUrl.startsWith("https://")) {
        throw new Error("--remote needs DATABASE_URL=libsql://… and DATABASE_AUTH_TOKEN in .env.production.local");
      }
      const db = createClient({ url: dbUrl, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
      const counts = await copyDatabase(db, path.join(staging, "journal.db"));
      db.close();
      const rows = Object.values(counts).reduce((a, b) => a + b, 0);
      console.log(`Turso database copied: ${Object.keys(counts).length} tables, ${rows} rows (trades: ${counts.trades ?? 0}, fills: ${counts.fills ?? 0}).`);

      const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
      if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET) {
        const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import("@aws-sdk/client-s3");
        const s3 = new S3Client({
          region: "auto",
          endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
        });
        const n = await downloadObjects(
          {
            list: async (token) => {
              const r = await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, ContinuationToken: token }));
              return { keys: (r.Contents ?? []).map((c) => c.Key!).filter(Boolean), next: r.IsTruncated ? r.NextContinuationToken : undefined };
            },
            get: async (key) => {
              const r = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
              return r.Body!.transformToByteArray();
            },
          },
          path.join(staging, "uploads"),
        );
        console.log(`R2 bucket downloaded: ${n} object(s).`);
      } else {
        console.log("R2 not configured (R2_* missing): screenshots skipped.");
      }
    }
    const out = path.join(outDir, `trading-journal-${remote ? "remote" : "local"}-${stamp}.tar.gz`);
    const size = makeArchive(staging, out);
    console.log(`\nBackup written: ${out} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}

main().catch((e) => {
  console.error("backup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
