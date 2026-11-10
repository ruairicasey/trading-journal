/**
 * Guards EVERY page and API route (see src/server/auth/access.ts for the rules).
 * Public code, private data: anyone can read these routes on GitHub, so nothing is reachable without a session.
 */
import { NextResponse, type NextRequest } from "next/server";
import { decideAccess } from "@/server/auth/access";
import { readAuthEnv } from "@/server/auth/env";
import { SESSION_COOKIE, verifySessionToken } from "@/server/auth/session";

export async function middleware(req: NextRequest) {
  const env = readAuthEnv();
  const { pathname, search } = req.nextUrl;
  const hasSession = env.authEnabled && !env.misconfigured
    ? await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, env.secret)
    : false;
  const d = decideAccess({ pathname, search, hasSession, env });

  switch (d.action) {
    case "allow":
      return NextResponse.next();
    case "redirect":
      return NextResponse.redirect(new URL(d.to, req.url));
    case "unauthorized":
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    case "unavailable":
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: d.reason }, { status: 503 });
      return new NextResponse(
        `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Unavailable</title>` +
          `<body style="background:#0a0a0a;color:#e5e5e5;font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0">` +
          `<div style="max-width:28rem;text-align:center"><h1 style="font-size:16px">Trading Journal is unavailable</h1>` +
          `<p style="color:#a3a3a3">${d.reason.replace(/[<>&]/g, "")}</p></div>`,
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
      );
  }
}

export const config = {
  // Everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
