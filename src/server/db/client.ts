import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { getConfig } from "../config";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

type Cache = { client?: Client; db?: DB; url?: string };
const g = globalThis as unknown as { __journalDb?: Cache };
const cache: Cache = (g.__journalDb ??= {});

export class DataUnavailableError extends Error {
  constructor() {
    super("Data access is disabled on preview deployments.");
  }
}

/** Shared libSQL/Drizzle handle. Local `file:` URLs create DATA_DIR on first use. */
export function getDb(): DB {
  const cfg = getConfig();
  if (cfg.isVercelPreview) throw new DataUnavailableError();
  if (cache.db && cache.url === cfg.db.url) return cache.db;

  if (cfg.isDeployed && cfg.db.url.startsWith("file:")) {
    // Serverless hosts have no persistent disk: a file DB would silently lose data.
    throw new Error("Deployed instances need DATABASE_URL set to a libsql:// (Turso) URL");
  }
  if (cfg.db.url.startsWith("file:")) {
    fs.mkdirSync(path.dirname(cfg.db.url.slice("file:".length)), { recursive: true });
  }
  const client = createClient({ url: cfg.db.url, authToken: cfg.db.authToken });
  cache.client = client;
  cache.url = cfg.db.url;
  cache.db = drizzle(client, { schema });
  return cache.db;
}

export function getClient(): Client {
  getDb();
  return cache.client!;
}
