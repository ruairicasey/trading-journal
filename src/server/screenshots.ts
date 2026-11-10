/**
 * Trade screenshots. Files go to private storage (local disk in dev, R2 when deployed) and are only ever
 * served through the authenticated /api/files route. The file type is decided by its magic bytes, never by
 * the client's filename or Content-Type, so an SVG/HTML file can't be smuggled in as "image.png".
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "./db/client";
import * as s from "./db/schema";
import type { BlobStorage } from "./storage";
import { MAX_SCREENSHOTS } from "../lib/journal-options";

export const MAX_BYTES = 4 * 1024 * 1024;

export class ScreenshotError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Detect PNG / JPEG / WebP / GIF from the first bytes. */
export function sniffImage(b: Uint8Array): { ext: string; mime: string } | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, j) => b[i + j] === x);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { ext: "png", mime: "image/png" };
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return { ext: "jpg", mime: "image/jpeg" };
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { ext: "webp", mime: "image/webp" };
  if (b.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return { ext: "gif", mime: "image/gif" };
  return null;
}

async function ownedTrade(db: DB, accountId: string, tradeId: string) {
  const t = await db.query.trades.findFirst({
    where: and(eq(s.trades.id, tradeId), eq(s.trades.accountId, accountId), isNull(s.trades.deletedAt)),
  });
  if (!t) throw new ScreenshotError("Trade not found", 404);
  return t;
}

async function ownedShot(db: DB, accountId: string, id: string) {
  const row = await db
    .select({ shot: s.screenshots })
    .from(s.screenshots)
    .innerJoin(s.trades, eq(s.trades.id, s.screenshots.tradeId))
    .where(and(eq(s.screenshots.id, id), eq(s.trades.accountId, accountId)))
    .limit(1);
  if (!row[0]) throw new ScreenshotError("Screenshot not found", 404);
  return row[0].shot;
}

export async function addScreenshot(
  db: DB,
  storage: BlobStorage,
  input: { accountId: string; tradeId: string; bytes: Uint8Array; width?: number | null; height?: number | null; caption?: string | null },
) {
  await ownedTrade(db, input.accountId, input.tradeId);
  if (input.bytes.byteLength === 0) throw new ScreenshotError("Empty file", 422);
  if (input.bytes.byteLength > MAX_BYTES) throw new ScreenshotError("Image is larger than 4 MB", 413);
  const type = sniffImage(input.bytes);
  if (!type) throw new ScreenshotError("Only PNG, JPEG, WebP or GIF images are allowed", 422);

  const [{ n, maxSort }] = await db
    .select({ n: sql<number>`count(*)`, maxSort: sql<number>`coalesce(max(${s.screenshots.sort}), -1)` })
    .from(s.screenshots)
    .where(eq(s.screenshots.tradeId, input.tradeId));
  if (Number(n) >= MAX_SCREENSHOTS) throw new ScreenshotError(`A trade can have up to ${MAX_SCREENSHOTS} screenshots`, 409);

  const key = `screenshots/${input.tradeId}/${nanoid()}.${type.ext}`;
  await storage.put(key, input.bytes, type.mime);
  const dim = (v: number | null | undefined) => (Number.isInteger(v) && v! > 0 && v! < 20_000 ? v! : null);
  const [row] = await db
    .insert(s.screenshots)
    .values({
      tradeId: input.tradeId,
      storageKey: key,
      caption: input.caption?.trim().slice(0, 300) || null,
      width: dim(input.width),
      height: dim(input.height),
      bytes: input.bytes.byteLength,
      sort: Number(maxSort) + 1,
    })
    .returning();
  return { id: row.id, url: `/api/files/${key}`, caption: row.caption, width: row.width, height: row.height };
}

export async function updateCaption(db: DB, accountId: string, id: string, caption: string | null) {
  await ownedShot(db, accountId, id);
  await db
    .update(s.screenshots)
    .set({ caption: caption?.trim().slice(0, 300) || null })
    .where(eq(s.screenshots.id, id));
}

export async function moveScreenshot(db: DB, accountId: string, id: string, direction: "left" | "right") {
  const shot = await ownedShot(db, accountId, id);
  const all = await db
    .select()
    .from(s.screenshots)
    .where(eq(s.screenshots.tradeId, shot.tradeId!))
    .orderBy(asc(s.screenshots.sort), asc(s.screenshots.createdAt));
  const i = all.findIndex((x) => x.id === id);
  const j = direction === "left" ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.transaction(async (tx) => {
    for (const [k, row] of all.entries()) {
      if (row.sort !== k) await tx.update(s.screenshots).set({ sort: k }).where(eq(s.screenshots.id, row.id));
    }
  });
}

export async function deleteScreenshot(db: DB, storage: BlobStorage, accountId: string, id: string) {
  const shot = await ownedShot(db, accountId, id);
  await storage.delete(shot.storageKey);
  await db.delete(s.screenshots).where(eq(s.screenshots.id, id));
}
