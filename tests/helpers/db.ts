import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetConfigForTests } from "@/server/config";

/** Point the app at a fresh throwaway SQLite file under the OS temp dir. */
export function useTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-test-"));
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
  delete process.env.HL_WALLET_ADDRESS;
  resetConfigForTests();
  const g = globalThis as unknown as { __journalDb?: object };
  g.__journalDb = {};
  return dir;
}
