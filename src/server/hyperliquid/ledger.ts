/**
 * Classify Hyperliquid ledger entries (userNonFundingLedgerUpdates) by their effect on your TRADING COLLATERAL:
 *  - standard accounts: the perp balance (what clearinghouseState.accountValue reports);
 *  - unified accounts (userAbstraction "unifiedAccount"): spot stablecoins are the collateral for perps, so spot
 *    transfers and sends of USDC (and other tokens, at their usdcValue) are flows in or out, and moves between
 *    your own spot and perp balances are internal.
 *
 * Field shapes verified live on public accounts (2026-11). Amount semantics marked "assumed" are checked by
 * the reconciliation in `npm run debug:ledger` before anything is built on them.
 */
import type { HlLedgerEntry } from "./schemas";

export type LedgerKind =
  | "deposit" // from outside Hyperliquid (bridge)
  | "withdraw" // to outside Hyperliquid
  | "transfer_in" // from another Hyperliquid account (incl. your own sub-accounts / other wallets)
  | "transfer_out"
  | "spot_perp" // between your own spot and perp balances
  | "vault" // into / out of vaults
  | "internal" // between your own perp dexes: no change to the total
  | "spot_only" // spot-side only (staking, spot sends, airdrops…): no perp effect
  | "no_cash" // e.g. a liquidation record: its loss is already in the fills
  | "unknown";

export type Classified = { kind: LedgerKind; /** signed effect on the trading collateral in USD */ perpUsd: number; note?: string };
export type LedgerOpts = { unified?: boolean };

const STABLES = new Set(["USDC", "USDH", "USDT0", "USDT", "USDE"]);
/** USD value of a spot token amount: stables at $1, otherwise the entry's own usdcValue. */
const usdOf = (d: Record<string, unknown>) => (STABLES.has(String(d.token ?? "").split(":")[0].toUpperCase()) ? n(d.amount) : n(d.usdcValue ?? d.amount));
/** Fee in USD when charged in a stablecoin; fees in other tokens (e.g. HYPE) are left out and reported. */
const feeUsd = (d: Record<string, unknown>) => (STABLES.has(String(d.feeToken ?? "USDC").split(":")[0].toUpperCase()) ? n(d.fee) : 0);

const n = (v: unknown) => {
  const x = Number(typeof v === "string" ? v.trim() : v);
  return Number.isFinite(x) ? x : 0;
};
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/** `dex` values on `send`: "" (main perp dex), a HIP-3 dex name, or "spot". */
const isPerpDex = (d: unknown) => d === undefined || d === null || (typeof d === "string" && d.toLowerCase() !== "spot");

export function classifyLedger(e: HlLedgerEntry, own: string, opts: LedgerOpts = {}): Classified {
  const d = e.delta as Record<string, unknown>;
  const unified = !!opts.unified;
  switch (d.type) {
    case "deposit":
      return { kind: "deposit", perpUsd: n(d.usdc) };
    case "withdraw":
      // assumed: `usdc` is the amount sent out; `fee` is charged on top
      return { kind: "withdraw", perpUsd: -(n(d.usdc) + n(d.fee)) };
    case "internalTransfer":
    case "subAccountTransfer": {
      const out = same(d.user, own);
      const inn = same(d.destination, own);
      if (out && inn) return { kind: "internal", perpUsd: 0 };
      if (out) return { kind: "transfer_out", perpUsd: -(n(d.usdc) + n(d.fee)) };
      if (inn) return { kind: "transfer_in", perpUsd: n(d.usdc) };
      return { kind: "unknown", perpUsd: 0, note: "neither side is this wallet" };
    }
    case "send": {
      // generic transfer between accounts and/or dexes ("" main perp dex, a HIP-3 dex, or "spot")
      const fromMe = same(d.user, own);
      const toMe = same(d.destination, own);
      if (unified) {
        // every leg is collateral: only money crossing to or from another account counts
        if (fromMe && toMe) return { kind: "internal", perpUsd: -feeUsd(d) };
        if (fromMe) return { kind: "transfer_out", perpUsd: -(usdOf(d) + feeUsd(d)) };
        if (toMe) return { kind: "transfer_in", perpUsd: usdOf(d) };
        return { kind: "unknown", perpUsd: 0, note: "neither side is this wallet" };
      }
      const out = fromMe && isPerpDex(d.sourceDex);
      const inn = toMe && isPerpDex(d.destinationDex);
      const usd = n(d.usdcValue ?? d.amount);
      if (out && inn) return { kind: "internal", perpUsd: -n(d.fee) };
      if (out) return { kind: toMe ? "spot_perp" : "transfer_out", perpUsd: -(usd + n(d.fee)) };
      if (inn) return { kind: fromMe ? "spot_perp" : "transfer_in", perpUsd: usd };
      return { kind: "spot_only", perpUsd: 0 };
    }
    case "spotTransfer": {
      if (!unified) return { kind: "spot_only", perpUsd: 0 };
      const fromMe = same(d.user, own);
      const toMe = same(d.destination, own);
      if (fromMe && toMe) return { kind: "internal", perpUsd: -feeUsd(d) };
      if (fromMe) return { kind: "transfer_out", perpUsd: -(usdOf(d) + feeUsd(d)) };
      if (toMe) return { kind: "transfer_in", perpUsd: usdOf(d) };
      return { kind: "unknown", perpUsd: 0, note: "neither side is this wallet" };
    }
    case "accountClassTransfer":
      // unified: spot and perp are one pool of collateral, so this moves nothing
      return unified ? { kind: "internal", perpUsd: 0 } : { kind: "spot_perp", perpUsd: d.toPerp ? n(d.usdc) : -n(d.usdc) };
    case "vaultDeposit":
      // from the depositor's side money leaves; if this wallet IS the vault, money arrives
      return { kind: "vault", perpUsd: same(d.vault, own) ? n(d.usdc) : -n(d.usdc) };
    case "vaultCreate":
      return { kind: "vault", perpUsd: -(n(d.usdc) + n(d.fee)) };
    case "vaultWithdraw":
      // assumed: netWithdrawnUsd is what reached your balance (after commission and closing cost)
      return { kind: "vault", perpUsd: same(d.vault, own) ? -n(d.requestedUsd ?? d.netWithdrawnUsd) : n(d.netWithdrawnUsd ?? d.requestedUsd) };
    case "vaultDistribution":
    case "vaultLeaderCommission":
      return { kind: "vault", perpUsd: n(d.usdc) };
    case "liquidation":
      return { kind: "no_cash", perpUsd: 0 };
    case "spotGenesis":
    case "cStakingTransfer":
    case "gossipPriorityGasAuction":
    case "borrowLend":
      return { kind: "spot_only", perpUsd: 0 };
    default:
      return { kind: "unknown", perpUsd: 0, note: `unhandled type ${String(d.type)}` };
  }
}
