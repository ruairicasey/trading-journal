/**
 * cTrader history export (History tab → Statement / export, saved as CSV, English headers) → closed positions.
 *
 * The export format isn't documented by Spotware, so columns are matched by name with aliases, and nothing is
 * imported without a preview first. One row is one closing deal; rows sharing a position ID are one trade
 * (partial closes). Money comes from the file's Gross / Commission / Swap / Net columns, which are exact in the
 * account currency; each row is checked: gross + commission + swap must equal net (else it's flagged).
 *
 * Keys match the API's (ctrader:<login>:<positionId>), so a later API sync replaces imported trades instead of
 * duplicating them, and re-importing the same file changes nothing.
 */
import { TZDate } from "@date-fns/tz";
import { ctraderKey, type PositionTrade } from "./positions";

/** server actions take up to 1 MB; a history file of thousands of positions fits well under this */
export const MAX_CSV_BYTES = 900_000;

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF/LF, a BOM; the delimiter is detected from the header line. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const head = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const counts = [",", ";", "\t"].map((c) => [c, head.split(c).length] as const).sort((a, b) => b[1] - a[1]);
  const delim = counts[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"' && f === "") q = true;
    else if (c === delim) {
      row.push(f);
      f = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(f);
      f = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

type Col =
  | "id"
  | "symbol"
  | "direction"
  | "openTime"
  | "closeTime"
  | "entry"
  | "exit"
  | "qty"
  | "commission"
  | "swap"
  | "gross"
  | "net";
const ALIASES: Record<Col, (h: string) => boolean> = {
  id: (h) => ["id", "position id", "position", "affected position", "position number"].includes(h),
  symbol: (h) => h === "symbol",
  direction: (h) => ["opening direction", "direction", "side", "type", "trade side"].includes(h),
  openTime: (h) =>
    ["opening time", "open time", "opening date", "entry time", "opening time utc"].includes(h) ||
    h.startsWith("opening time"),
  closeTime: (h) =>
    ["closing time", "close time", "closing date", "exit time"].includes(h) || h.startsWith("closing time"),
  entry: (h) => ["entry price", "opening price", "open price"].includes(h),
  exit: (h) => ["closing price", "close price", "exit price"].includes(h),
  qty: (h) =>
    ["closing quantity", "quantity", "volume", "closing volume", "lots", "closed volume"].includes(h),
  commission: (h) => h === "commission" || h === "commissions",
  swap: (h) => h === "swap" || h === "swaps",
  gross: (h) => h === "gross" || (h.startsWith("gross ") && !h.includes("pip")),
  net: (h) => h === "net" || (h.startsWith("net ") && !h.includes("pip")),
};
const REQUIRED: Col[] = ["id", "symbol", "direction", "openTime", "closeTime", "net"];

/** "1,234.56", "1.234,56", "−12.3", "$ 12", "(12.30)" → number; null when it isn't one. */
export function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw
    .trim()
    .replace(/[−–]/g, "-")
    .replace(/[^\d.,\-()]/g, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot !== -1 && lastComma !== -1) {
    const dec = lastDot > lastComma ? "." : ",";
    s = s.split(dec === "." ? "," : ".").join("");
    if (dec === ",") s = s.replace(",", ".");
  } else if (lastComma !== -1) {
    // a lone comma group of exactly three digits is thousands ("1,234"), otherwise a decimal comma ("12,5")
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.split(",").join("") : s.replace(",", ".");
  }
  if (!/^\d*\.?\d+$/.test(s) && !/^\d+\.?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** "2026-11-19 13:45:00(.123)", "19/11/2026 13:45:00", "19.11.2026 13:45" (day first), in `tz`. */
export function parseTime(raw: string | undefined, tz: string): number | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  const [h, mi, sec, ms] = [
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
    Number((m[7] ?? "0").padEnd(3, "0")),
  ];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  const t = new TZDate(y, mo - 1, d, h, mi, sec, ms, tz);
  return t.getDate() === d ? t.getTime() : null;
}

export type CsvRowIssue = { row: number; problem: string };
export type CsvPreview = {
  rows: number;
  trades: PositionTrade[];
  issues: CsvRowIssue[];
  missing: string[];
  net: number;
};

const LABELS: Record<Col, string> = {
  id: "ID / Position ID",
  symbol: "Symbol",
  direction: "Opening Direction",
  openTime: "Opening Time",
  closeTime: "Closing Time",
  entry: "Entry Price",
  exit: "Closing Price",
  qty: "Closing Quantity",
  commission: "Commission",
  swap: "Swap",
  gross: "Gross",
  net: "Net",
};

/** Parse and check a whole file; nothing is written. */
export function previewCsv(text: string, o: { login: string; tz: string }): CsvPreview {
  const all = parseCsv(text);
  // the header is the first row that names the required columns (statements can start with a title block)
  const hi = all.findIndex((r) => {
    const hs = r.map(norm);
    return REQUIRED.every((c) => hs.some(ALIASES[c]));
  });
  if (hi === -1) {
    const hs = (all[0] ?? []).map(norm);
    return {
      rows: 0,
      trades: [],
      issues: [],
      missing: REQUIRED.filter((c) => !hs.some(ALIASES[c])).map((c) => LABELS[c]),
      net: 0,
    };
  }
  const hs = all[hi].map(norm);
  const idx = Object.fromEntries(
    (Object.keys(ALIASES) as Col[]).map((c) => [c, hs.findIndex(ALIASES[c])]),
  ) as Record<Col, number>;
  const get = (r: string[], c: Col) => (idx[c] === -1 ? undefined : r[idx[c]]);

  type Row = {
    id: string;
    symbol: string;
    long: boolean;
    open: number;
    close: number;
    entry: number | null;
    exit: number | null;
    qty: number;
    gross: number;
    commission: number;
    swap: number;
    net: number;
  };
  const rows: Row[] = [];
  const issues: CsvRowIssue[] = [];
  all.slice(hi + 1).forEach((r, i) => {
    const line = hi + i + 2;
    const id = get(r, "id")?.trim().replace(/^#/, "");
    const symbol = get(r, "symbol")?.trim();
    if (!id && !symbol) return; // totals / blank lines
    const dir = get(r, "direction")?.trim().toLowerCase() ?? "";
    const long = /^(buy|long)/.test(dir);
    const open = parseTime(get(r, "openTime"), o.tz);
    const close = parseTime(get(r, "closeTime"), o.tz);
    const net = parseNumber(get(r, "net"));
    const problems: string[] = [];
    if (!id || !/^\d+$/.test(id)) problems.push("no position ID");
    if (!symbol) problems.push("no symbol");
    if (!long && !/^(sell|short)/.test(dir)) problems.push("direction isn't Buy or Sell");
    if (open === null) problems.push("opening time not understood");
    if (close === null) problems.push("closing time not understood");
    if (net === null) problems.push("net not a number");
    if (problems.length) {
      issues.push({ row: line, problem: problems.join(", ") });
      return;
    }
    const commission = parseNumber(get(r, "commission")) ?? 0;
    const swap = parseNumber(get(r, "swap")) ?? 0;
    const gross = parseNumber(get(r, "gross")) ?? net! - commission - swap;
    if (Math.abs(gross + commission + swap - net!) > 0.015) {
      issues.push({ row: line, problem: "gross + commission + swap ≠ net (imported using Net)" });
    }
    rows.push({
      id: id!,
      symbol: symbol!,
      long,
      open: open!,
      close: close!,
      entry: parseNumber(get(r, "entry")),
      exit: parseNumber(get(r, "exit")),
      qty: Math.abs(parseNumber(get(r, "qty")) ?? 0),
      gross,
      commission,
      swap,
      net: net!,
    });
  });

  const byId = new Map<string, Row[]>();
  for (const r of rows) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  const trades: PositionTrade[] = [];
  for (const [id, rs] of byId) {
    rs.sort((a, b) => a.close - b.close);
    const units = rs.reduce((a, r) => a + r.qty, 0);
    const w = (k: "entry" | "exit") => {
      const xs = rs.filter((r) => r.qty > 0 && r[k] !== null);
      const u = xs.reduce((a, r) => a + r.qty, 0);
      return u > 0
        ? xs.reduce((a, r) => a + r.qty * r[k]!, 0) / u
        : (rs.find((r) => r[k] !== null)?.[k] ?? null);
    };
    const avgEntry = w("entry");
    const commission = rs.reduce((a, r) => a + r.commission, 0);
    const funding = rs.reduce((a, r) => a + r.swap, 0);
    const net = rs.reduce((a, r) => a + r.net, 0);
    const entryTime = Math.min(...rs.map((r) => r.open));
    const exitTime = Math.max(...rs.map((r) => r.close));
    trades.push({
      externalKey: ctraderKey(o.login, id),
      positionId: Number(id),
      coin: rs[0].symbol,
      displayPair: rs[0].symbol,
      direction: rs[0].long ? "long" : "short",
      status: "closed",
      avgEntry,
      avgExit: w("exit"),
      sizeUnits: units,
      entryUnitsTotal: units,
      exitUnitsTotal: units,
      // the file's quantity may be lots or units, so no USD notional is claimed from it
      notionalUsd: null,
      // gross is defined so that gross − fees + funding = the file's Net exactly
      grossPnl: net + -commission - funding,
      fees: -commission,
      funding,
      entryTime,
      exitTime,
      durationMs: exitTime - entryTime,
      fillCount: rs.length,
      partialHistory: false,
    });
  }
  trades.sort((a, b) => a.exitTime! - b.exitTime!);
  return {
    rows: rows.length,
    trades,
    issues,
    missing: [],
    net: trades.reduce((a, t) => a + t.grossPnl - t.fees + t.funding, 0),
  };
}
