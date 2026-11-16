import { describe, expect, test } from "vitest";
import { classifyLedger } from "@/server/hyperliquid/ledger";
import { LedgerSchema } from "@/server/hyperliquid/schemas";

const ME = "0x0000000000000000000000000000000000000001";
const OTHER = "0x0000000000000000000000000000000000000002";
const VAULT = "0x0000000000000000000000000000000000000003";
const e = (delta: Record<string, unknown>) => LedgerSchema.parse([{ time: 1, hash: "0x00", delta }])[0];
const c = (delta: Record<string, unknown>, own = ME) => classifyLedger(e(delta), own);

describe("ledger classification (effect on the perp balance)", () => {
  test("deposits and withdrawals (withdraw fee on top); values may be padded strings", () => {
    expect(c({ type: "deposit", usdc: " 500.0" })).toEqual({ kind: "deposit", perpUsd: 500 });
    expect(c({ type: "withdraw", usdc: "200.0", fee: "1.0", nonce: 1 })).toEqual({ kind: "withdraw", perpUsd: -201 });
  });

  test("transfers depend on which side is this wallet; both sides = internal", () => {
    expect(c({ type: "internalTransfer", user: ME, destination: OTHER, usdc: "50", fee: "1" })).toEqual({ kind: "transfer_out", perpUsd: -51 });
    expect(c({ type: "subAccountTransfer", user: OTHER, destination: ME, usdc: "75" })).toEqual({ kind: "transfer_in", perpUsd: 75 });
    expect(c({ type: "subAccountTransfer", user: ME, destination: ME, usdc: "75" }).kind).toBe("internal");
    expect(c({ type: "internalTransfer", user: OTHER, destination: VAULT, usdc: "1" }).kind).toBe("unknown");
    // addresses compare case-insensitively
    expect(c({ type: "subAccountTransfer", user: OTHER, destination: ME.toUpperCase().replace("0X", "0x"), usdc: "5" }).perpUsd).toBe(5);
  });

  test("send: perp-dex legs move the perp balance, spot legs don't, own dex-to-dex is internal", () => {
    const base = { type: "send", token: "USDC", amount: "10", usdcValue: "10", fee: "0", nonce: 1, nativeTokenFee: "0", feeToken: "USDC" };
    expect(c({ ...base, user: ME, destination: OTHER, sourceDex: "", destinationDex: "" })).toEqual({ kind: "transfer_out", perpUsd: -10 });
    expect(c({ ...base, user: ME, destination: ME, sourceDex: "", destinationDex: "xyz" })).toEqual({ kind: "internal", perpUsd: -0 });
    expect(c({ ...base, user: ME, destination: ME, sourceDex: "spot", destinationDex: "" })).toEqual({ kind: "spot_perp", perpUsd: 10 });
    expect(c({ ...base, user: OTHER, destination: ME, sourceDex: "spot", destinationDex: "spot" }).kind).toBe("spot_only");
  });

  test("spot ↔ perp and vault flows, from the depositor's side and from the vault's own side", () => {
    expect(c({ type: "accountClassTransfer", usdc: "30", toPerp: true }).perpUsd).toBe(30);
    expect(c({ type: "accountClassTransfer", usdc: "30", toPerp: false }).perpUsd).toBe(-30);
    expect(c({ type: "vaultDeposit", vault: VAULT, usdc: "100" }).perpUsd).toBe(-100);
    expect(c({ type: "vaultWithdraw", vault: VAULT, user: ME, requestedUsd: "110", netWithdrawnUsd: "105", commission: "5", closingCost: "0", basis: "100" }).perpUsd).toBe(105);
    expect(c({ type: "vaultDeposit", vault: VAULT, usdc: "100" }, VAULT).perpUsd).toBe(100);
    expect(c({ type: "vaultWithdraw", vault: VAULT, user: OTHER, requestedUsd: "110", netWithdrawnUsd: "105" }, VAULT).perpUsd).toBe(-110);
  });

  test("spot-only types, liquidation records and unknown types never move the perp balance", () => {
    for (const type of ["spotTransfer", "spotGenesis", "cStakingTransfer", "gossipPriorityGasAuction", "borrowLend"]) expect(c({ type, amount: "5" })).toMatchObject({ kind: "spot_only", perpUsd: 0 });
    expect(c({ type: "liquidation", accountValue: "1" })).toMatchObject({ kind: "no_cash", perpUsd: 0 });
    expect(c({ type: "somethingNew" })).toMatchObject({ kind: "unknown", perpUsd: 0 });
  });
});
