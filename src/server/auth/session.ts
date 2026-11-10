/** Signed session cookie (HS256 JWT via jose). Edge-safe: used by middleware and Node routes. */
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "tj_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const key = (secret: string) => new TextEncoder().encode(secret);

export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SECONDS)
    .setAudience("trading-journal")
    .sign(key(secret));
}

export async function verifySessionToken(token: string | undefined, secret: string | undefined, now = Date.now()) {
  if (!token || !secret) return false;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ["HS256"],
      audience: "trading-journal",
      currentDate: new Date(now),
    });
    return payload.sub === "owner";
  } catch {
    return false;
  }
}

export function sessionCookieOptions(production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
