/**
 * Classify Hyperliquid ledger entries (userNonFundingLedgerUpdates) by their effect on the PERP account
 * balance, the balance that trading P&L and funding land in and that clearinghouseState.accountValue reports.
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

export type Classified = { kind: LedgerKind; /** signed effect on the perp balance in USD */ perpUsd: number; note?: string };

const n = (v: unknown) => {
  const x = Number(typeof v === "string" ? v.trim() : v);
  return Number.isFinite(x) ? x : 0;
};
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();

/** `dex` values on `send`: "" (main perp dex), a HIP-3 dex name, or "spot". */
const isPerpDex = (d: unknown) => d === undefined || d === null || (typeof d === "string" && d.toLowerCase() !== "spot");

export function classifyLedger(e: HlLedgerEntry, own: string): Classified {
  const d = e.delta as Record<string, unknown>;
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
      // generic transfer between accounts and/or dexes; only USDC-valued legs on a perp dex move the perp balance
      const out = same(d.user, own) && isPerpDex(d.sourceDex);
      const inn = same(d.destination, own) && isPerpDex(d.destinationDex);
      const usd = n(d.usdcValue ?? d.amount);
      if (out && inn) return { kind: "internal", perpUsd: -n(d.fee) };
      if (out) return { kind: same(d.destination, own) ? "spot_perp" : "transfer_out", perpUsd: -(usd + n(d.fee)) };
      if (inn) return { kind: same(d.user, own) ? "spot_perp" : "transfer_in", perpUsd: usd };
      return { kind: "spot_only", perpUsd: 0 };
    }
    case "accountClassTransfer":
      return { kind: "spot_perp", perpUsd: d.toPerp ? n(d.usdc) : -n(d.usdc) };
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
    case "spotTransfer":
    case "spotGenesis":
    case "cStakingTransfer":
    case "gossipPriorityGasAuction":
    case "borrowLend":
      return { kind: "spot_only", perpUsd: 0 };
    default:
      return { kind: "unknown", perpUsd: 0, note: `unhandled type ${String(d.type)}` };
  }
}
