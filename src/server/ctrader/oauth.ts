/**
 * cTrader Open API OAuth (https://help.ctrader.com/open-api/account-authentication/).
 *  - The grant screen is id.ctrader.com; the scope is ALWAYS "accounts" (view-only). This app never asks for "trading".
 *  - Codes are exchanged (and tokens refreshed) at openapi.ctrader.com/apps/token. Access tokens last ~30 days;
 *    every refresh returns a NEW refresh token and invalidates the old one, so the caller must store it at once.
 *  - Errors never include tokens, codes or the client secret.
 */
import { z } from "zod";

export const CTRADER_SCOPE = "accounts";
export const STATE_COOKIE = "ctrader_oauth_state";
const AUTH_URL = "https://id.ctrader.com/my/settings/openapi/grantingaccess/";
const TOKEN_URL = "https://openapi.ctrader.com/apps/token";

export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("scope", CTRADER_SCOPE);
  u.searchParams.set("product", "web");
  u.searchParams.set("state", o.state);
  return u.toString();
}

export const redirectUriFor = (origin: string) => new URL("/api/ctrader/callback", origin).toString();

const TokenRes = z.object({
  accessToken: z.string().nullish(),
  refreshToken: z.string().nullish(),
  expiresIn: z.coerce.number().nullish(),
  errorCode: z.string().nullish(),
  description: z.string().nullish(),
});

export type Tokens = { accessToken: string; refreshToken: string; expiresAt: number };

export class CtraderAuthError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function tokenRequest(
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  now: number,
): Promise<Tokens> {
  const u = new URL(TOKEN_URL);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetchImpl(u, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new CtraderAuthError("cTrader token service unreachable");
  }
  const body = TokenRes.safeParse(await res.json().catch(() => null));
  if (!body.success)
    throw new CtraderAuthError(`cTrader token service returned an unexpected response (HTTP ${res.status})`);
  const b = body.data;
  if (b.errorCode || !b.accessToken || !b.refreshToken) {
    // the error code is a fixed identifier (e.g. ACCESS_DENIED); the description is cTrader's own text
    throw new CtraderAuthError(
      `cTrader refused the token request: ${b.errorCode ?? `HTTP ${res.status}`}`,
      b.errorCode ?? undefined,
    );
  }
  return {
    accessToken: b.accessToken,
    refreshToken: b.refreshToken,
    expiresAt: now + (b.expiresIn ?? 2_628_000) * 1000,
  };
}

export function exchangeCode(
  o: { code: string; redirectUri: string; clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
) {
  return tokenRequest(
    {
      grant_type: "authorization_code",
      code: o.code,
      redirect_uri: o.redirectUri,
      client_id: o.clientId,
      client_secret: o.clientSecret,
    },
    fetchImpl,
    now,
  );
}

export function refreshTokens(
  o: { refreshToken: string; clientId: string; clientSecret: string },
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
) {
  return tokenRequest(
    {
      grant_type: "refresh_token",
      refresh_token: o.refreshToken,
      client_id: o.clientId,
      client_secret: o.clientSecret,
    },
    fetchImpl,
    now,
  );
}
