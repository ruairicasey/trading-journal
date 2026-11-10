import { NextResponse } from "next/server";
import { z } from "zod";
import { safeNext } from "@/server/auth/access";
import { readAuthEnv } from "@/server/auth/env";
import { verifyPassword } from "@/server/auth/password";
import { attemptKey, clearFailures, lockedFor, recordFailure } from "@/server/auth/rate-limit";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { getDb } from "@/server/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ password: z.string().min(1).max(512), next: z.string().max(512).optional() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function clientIp(req: Request) {
  // On Vercel, x-forwarded-for is set by the platform; first entry is the client.
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

export async function POST(req: Request) {
  const env = readAuthEnv();
  if (!env.authEnabled) return NextResponse.json({ ok: true, next: "/dashboard" }); // local, no password set
  if (env.misconfigured || !env.secret) return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const db = getDb();
  const key = attemptKey(clientIp(req), env.secret);
  const wait = await lockedFor(db, key);
  if (wait > 0) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${Math.ceil(wait / 60_000)} min.` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(wait / 1000)) } },
    );
  }

  const ok = await verifyPassword(parsed.data.password, env.passwordHash);
  if (!ok) {
    await recordFailure(db, key);
    await sleep(400 + Math.random() * 300); // slow down guessing
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  await clearFailures(db, key);
  const res = NextResponse.json({ ok: true, next: safeNext(parsed.data.next) });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(env.secret), sessionCookieOptions(env.production));
  return res;
}
