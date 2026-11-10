/**
 * Blob storage for screenshots. Local disk (DATA_DIR/uploads) in development; a PRIVATE Cloudflare R2
 * bucket when deployed. Files are never public: they are served only through the authenticated
 * /api/files/[...key] route.
 */
import { getConfig } from "../config";
import { LocalStorage } from "./local";
import { R2Storage } from "./r2";

export type StoredObject = { body: Uint8Array; contentType: string };

export interface BlobStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export { assertSafeKey, CONTENT_TYPES } from "./keys";

let cached: BlobStorage | undefined;

export function getStorage(): BlobStorage {
  if (cached) return cached;
  const cfg = getConfig();
  if (cfg.storage.driver === "r2") {
    const { accountId, accessKeyId, secretAccessKey, bucket } = cfg.storage.r2;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error("STORAGE_DRIVER=r2 needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET");
    }
    cached = new R2Storage({ accountId, accessKeyId, secretAccessKey, bucket });
  } else {
    // A deployed (serverless) instance has no persistent disk: refuse rather than silently lose screenshots.
    if (cfg.isDeployed) throw new Error("Deployed instances must use STORAGE_DRIVER=r2");
    cached = new LocalStorage(cfg.uploadsDir);
  }
  return cached;
}
