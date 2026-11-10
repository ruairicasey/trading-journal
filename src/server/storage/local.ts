import fs from "node:fs/promises";
import path from "node:path";
import type { BlobStorage, StoredObject } from "./index";
import { assertSafeKey } from "./keys";

export class LocalStorage implements BlobStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    assertSafeKey(key);
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, body: Uint8Array, _contentType?: string) {
    void _contentType; // derived from the key extension on read
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }

  async get(key: string): Promise<StoredObject | null> {
    const full = this.resolve(key);
    try {
      return { body: new Uint8Array(await fs.readFile(full)), contentType: assertSafeKey(key) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }
}
