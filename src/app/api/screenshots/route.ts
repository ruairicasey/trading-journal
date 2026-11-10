/**
 * POST /api/screenshots (multipart: tradeId, file, width?, height?). Session-protected by middleware.
 * The client compresses images first; the server re-checks size and type (magic bytes).
 */
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getActiveAccount } from "@/server/db/queries/settings";
import { addScreenshot, MAX_BYTES, ScreenshotError } from "@/server/screenshots";
import { getStorage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "Image is larger than 4 MB" }, { status: 413 });
  const { active } = await getActiveAccount();
  if (!active) return NextResponse.json({ error: "No account" }, { status: 400 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }
  const file = form.get("file");
  const tradeId = String(form.get("tradeId") ?? "");
  if (!(file instanceof Blob) || !tradeId) return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  try {
    const shot = await addScreenshot(getDb(), getStorage(), {
      accountId: active.id,
      tradeId,
      bytes: new Uint8Array(await file.arrayBuffer()),
      width: Number(form.get("width")) || null,
      height: Number(form.get("height")) || null,
    });
    return NextResponse.json(shot, { status: 201 });
  } catch (e) {
    if (e instanceof ScreenshotError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("screenshot upload failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
