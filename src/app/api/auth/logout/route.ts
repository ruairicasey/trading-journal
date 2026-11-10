import { NextResponse } from "next/server";
import { readAuthEnv } from "@/server/auth/env";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(readAuthEnv().production), maxAge: 0 });
  return res;
}
