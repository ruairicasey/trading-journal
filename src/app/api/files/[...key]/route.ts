/** Serves private screenshots. Session-protected by middleware like every other route. */
import { NextResponse } from "next/server";
import { assertSafeKey, getStorage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  try {
    assertSafeKey(key);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const obj = await getStorage().get(key);
  if (!obj) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new Response(Buffer.from(obj.body), {
    headers: {
      "Content-Type": obj.contentType,
      // private: browsers may cache, shared caches/CDNs must not
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
