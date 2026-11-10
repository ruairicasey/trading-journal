import type { BasicInput, TradeEditData } from "@/server/trades/journal";

/** Editable rows allow blanks while typing; they're validated before saving. */
export type Row<T extends string> = Record<T, number | null>;

export type Draft = Omit<BasicInput, "tpPartials" | "manual"> & {
  tpPartials: Row<"price" | "pct">[];
  manual?: Omit<NonNullable<BasicInput["manual"]>, "dca"> & { dca: Row<"price" | "size">[] };
};

export type AccountOpt = { id: string; name: string; startingBalance: number; standardRiskPct: number };

export type FormProps = {
  data: TradeEditData;
  accounts: AccountOpt[];
  sessions: { name: string; startUtc: number; endUtc: number }[];
  tz: string;
};

export function initialDraft(data: TradeEditData): Draft {
  const { trade, journal } = data;
  const manual = trade.source === "manual";
  return {
    accountId: trade.accountId,
    strategyId: journal?.strategyId ?? null,
    stopLoss: journal?.stopLoss ?? null,
    takeProfit: journal?.takeProfit ?? null,
    sizeMode: journal?.sizeMode ?? "position",
    plannedRiskUsd: journal?.plannedRiskUsd ?? null,
    leverageOverride: journal?.leverageOverride ?? null,
    session: journal?.session ?? null,
    tradeType: journal?.tradeType ?? null,
    feeOverride: journal?.feeOverride ?? null,
    checklist: data.checklistIds,
    tpPartials: data.tpPartials,
    manual: manual
      ? {
          coin: trade.coin,
          direction: trade.direction,
          status: trade.status,
          entry: journal?.manualEntry ?? trade.avgEntry ?? null,
          exit: journal?.manualExit ?? trade.avgExit ?? null,
          size: journal?.manualSize ?? trade.sizeUnits ?? null,
          entryTime: journal?.manualEntryTime ?? trade.entryTime ?? null,
          exitTime: journal?.manualExitTime ?? trade.exitTime ?? null,
          dca: data.dca,
        }
      : undefined,
  };
}

/** Draft → save payload, or a message explaining what's incomplete. */
export function toPayload(d: Draft): { input: BasicInput | null; error: string | null } {
  const rows = <T extends string>(xs: Row<T>[], keys: T[], what: string) => {
    const kept = xs.filter((r) => keys.some((k) => r[k] !== null));
    if (kept.some((r) => keys.some((k) => r[k] === null))) return { error: `Complete or remove the empty ${what} row` };
    return { rows: kept as Record<T, number>[] };
  };
  const tp = rows(d.tpPartials, ["price", "pct"], "take-profit");
  if ("error" in tp) return { input: null, error: tp.error ?? null };
  let manual: BasicInput["manual"];
  if (d.manual) {
    const dca = rows(d.manual.dca, ["price", "size"], "partial-entry");
    if ("error" in dca) return { input: null, error: dca.error ?? null };
    if (!d.manual.coin.trim()) return { input: null, error: "Enter a pair" };
    manual = { ...d.manual, coin: d.manual.coin.trim(), dca: dca.rows };
  }
  return { input: { ...d, tpPartials: tp.rows, manual }, error: null };
}
