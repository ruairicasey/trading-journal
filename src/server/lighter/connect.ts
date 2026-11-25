/** Add a Lighter account, or give one a new token. Every problem comes back as text that never contains the token. */
import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { sanitizeError } from "../sync/runs";
import { LighterApiError, type LighterClient } from "./client";
import type { LighterDeps } from "./sync";
import { parseReadOnlyToken, sealToken, type ReadOnlyToken } from "./token";

export type ConnectResult = { ok: true; walletId: string } | { ok: false; error: string };
const no = (error: string): ConnectResult => ({ ok: false, error });

type Checked =
  { ok: true; token: ReadOnlyToken; address: string; enc: string } | { ok: false; error: string };

async function check(deps: LighterDeps, raw: string, now: number): Promise<Checked> {
  const token = parseReadOnlyToken(raw);
  if (!token)
    return {
      ok: false,
      error:
        "That isn't a read-only token. It should start with ro: (never paste an API key or a private key).",
    };
  if (token.expiresAt <= now) return { ok: false, error: "That token has already expired." };
  if (!deps.tokenSecret)
    return { ok: false, error: "AUTH_SECRET (32+ characters) must be set before a token can be stored." };
  const client: LighterClient = deps.client;
  try {
    const account = await client.account(token.accountIndex);
    if (!/^0x[0-9a-fA-F]{40}$/.test(account.l1_address))
      return { ok: false, error: "Lighter didn't say which wallet owns that account." };
    // a call that needs the token: some trade lists answer without one
    await client.activeOrders({ token: raw.trim(), account: token.accountIndex });
    return {
      ok: true,
      token,
      address: account.l1_address.toLowerCase(),
      enc: sealToken(raw, deps.tokenSecret),
    };
  } catch (e) {
    const refused =
      e instanceof LighterApiError &&
      e.status !== undefined &&
      e.status >= 400 &&
      e.status < 500 &&
      e.status !== 429 &&
      e.status !== 405;
    return {
      ok: false,
      error: refused
        ? "Lighter refused that token. Check it was copied whole and hasn't been revoked."
        : `Couldn't reach Lighter (${sanitizeError(e)}). Try again.`,
    };
  }
}

export async function connectLighter(
  db: DB,
  deps: LighterDeps,
  input: { token: string; label: string; accountId: string },
  now = Date.now(),
): Promise<ConnectResult> {
  const c = await check(deps, input.token, now);
  if (!c.ok) return no(c.error);
  const [account] = await db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(and(eq(s.accounts.id, input.accountId), eq(s.accounts.archived, false)));
  if (!account) return no("Pick an active journal account.");
  return db.transaction(async (tx): Promise<ConnectResult> => {
    const key = and(
      eq(s.wallets.exchange, "lighter"),
      eq(s.wallets.address, c.address),
      eq(s.wallets.accountIndex, c.token.accountIndex),
    );
    const [existing] = await tx
      .select({ label: s.wallets.label, enabled: s.wallets.enabled })
      .from(s.wallets)
      .where(key);
    if (existing)
      return no(
        `That account is already added as "${existing.label}". Use Replace token on its card${existing.enabled ? "" : " and switch it on"}.`,
      );
    const [w] = await tx
      .insert(s.wallets)
      .values({
        accountId: account.id,
        exchange: "lighter",
        address: c.address,
        accountIndex: c.token.accountIndex,
        label: input.label,
      })
      .returning({ id: s.wallets.id });
    const walletId = w.id;
    const set = { tokenEnc: c.enc, tokenExpiresAt: c.token.expiresAt };
    await tx
      .insert(s.lighterState)
      .values({ walletId, ...set })
      .onConflictDoUpdate({ target: s.lighterState.walletId, set });
    return { ok: true, walletId };
  });
}

/** A new token for an account already added: it must be for that same account. */
export async function replaceToken(
  db: DB,
  deps: LighterDeps,
  input: { walletId: string; token: string },
  now = Date.now(),
): Promise<ConnectResult> {
  const wallet = await db.query.wallets.findFirst({ where: eq(s.wallets.id, input.walletId) });
  if (!wallet || wallet.exchange !== "lighter") return no("That Lighter account no longer exists.");
  const c = await check(deps, input.token, now);
  if (!c.ok) return no(c.error);
  if (c.token.accountIndex !== wallet.accountIndex || c.address !== wallet.address)
    return no("That token is for a different Lighter account.");
  const set = { tokenEnc: c.enc, tokenExpiresAt: c.token.expiresAt };
  await db
    .insert(s.lighterState)
    .values({ walletId: wallet.id, ...set })
    .onConflictDoUpdate({ target: s.lighterState.walletId, set });
  return { ok: true, walletId: wallet.id };
}

/** Forget the token; the wallet, its fills and its trades stay. */
export async function removeToken(db: DB, walletId: string) {
  await db
    .update(s.lighterState)
    .set({ tokenEnc: null, tokenExpiresAt: null })
    .where(eq(s.lighterState.walletId, walletId));
}
