/**
 * TradingView snapshot links → a stored screenshot. A snapshot link (tradingview.com/x/<id>/, from "Copy link" or
 * Alt+S) points at a page; its image is a PNG on TradingView's snapshot host. The server fetches ONLY that host,
 * builds the URL itself from a strictly validated id (never fetches what the user typed), refuses redirects, caps the
 * size and checks the bytes are an image, so the link can't be used to make the server fetch anything else.
 */
import type { DB } from "./db/client";
import { addScreenshot, MAX_BYTES, pngSize, ScreenshotError } from "./screenshots";
import type { BlobStorage } from "./storage";

const ID = /^[A-Za-z0-9]{6,16}$/;
const HOSTS = new Set(["tradingview.com", "www.tradingview.com"]);

/** The snapshot id from a TradingView link, or null if it isn't one. Accepts the /x/ page link and the image link. */
export function parseSnapshotLink(input: string): string | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  // www.tradingview.com/x/AbCd1234/ (also regional subdomains like uk.tradingview.com)
  if ((HOSTS.has(host) || /^[a-z]{2}\.tradingview\.com$/.test(host)) && parts.length === 2 && parts[0] === "x" && ID.test(parts[1])) return parts[1];
  // s3.tradingview.com/snapshots/a/AbCd1234.png
  if (host === "s3.tradingview.com" && parts.length === 3 && parts[0] === "snapshots") {
    const m = /^([A-Za-z0-9]+)\.png$/.exec(parts[2]);
    if (m && ID.test(m[1]) && parts[1] === m[1][0].toLowerCase()) return m[1];
  }
  return null;
}

export const snapshotImageUrl = (id: string) => `https://s3.tradingview.com/snapshots/${id[0].toLowerCase()}/${id}.png`;
export const snapshotPageUrl = (id: string) => `https://www.tradingview.com/x/${id}/`;

/** Downloads the snapshot PNG (bytes only; the caller stores it). */
export async function fetchSnapshot(id: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  if (!ID.test(id)) throw new ScreenshotError("That isn't a TradingView snapshot link", 422);
  let res: Response;
  try {
    res = await fetchImpl(snapshotImageUrl(id), { redirect: "error", signal: AbortSignal.timeout(10_000), cache: "no-store" });
  } catch {
    throw new ScreenshotError("Couldn't reach TradingView; try again", 502);
  }
  if (res.status === 404 || res.status === 403) throw new ScreenshotError("TradingView has no snapshot with that link", 404);
  if (!res.ok || !res.body) throw new ScreenshotError(`TradingView answered ${res.status}; try again`, 502);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new ScreenshotError("Image is larger than 4 MB", 413);

  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new ScreenshotError("Image is larger than 4 MB", 413);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** Link → stored screenshot on the trade, keeping the snapshot's page link as its source. */
export async function importSnapshot(
  db: DB,
  storage: BlobStorage,
  input: { accountId: string; tradeId: string; link: string },
  fetchImpl: (id: string) => Promise<Uint8Array> = (id) => fetchSnapshot(id),
) {
  const id = parseSnapshotLink(input.link);
  if (!id) throw new ScreenshotError("That isn't a TradingView snapshot link (tradingview.com/x/…)", 422);
  const bytes = await fetchImpl(id);
  const size = pngSize(bytes);
  return addScreenshot(db, storage, { accountId: input.accountId, tradeId: input.tradeId, bytes, ...size, caption: "TradingView", sourceUrl: snapshotPageUrl(id) });
}
