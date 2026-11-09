/**
 * Environment for the demo account. Always points at ./data/demo, never at your real DB,
 * and blanks personal values so nothing from .env.local leaks into the demo.
 */
import path from "node:path";

export const DEMO_DATA_DIR = path.resolve("data/demo");
export const DEMO_DB_FILE = path.join(DEMO_DATA_DIR, "journal.db");

export function applyDemoEnv(env: NodeJS.ProcessEnv = process.env) {
  env.DATA_DIR = DEMO_DATA_DIR;
  env.DATABASE_URL = `file:${DEMO_DB_FILE}`;
  // Empty values (not deleted) so Next's .env.local loading can't fill them back in.
  env.DATABASE_AUTH_TOKEN = "";
  env.HL_WALLET_ADDRESS = "";
  env.STORAGE_DRIVER = "local";
  env.TJ_DEMO = "1";
  return env;
}
