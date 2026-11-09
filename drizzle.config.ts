import path from "node:path";
import { defineConfig } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());
const dataDir = path.resolve(process.env.DATA_DIR || "./data");

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.DATABASE_URL || `file:${path.join(dataDir, "journal.db")}`,
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  },
});
