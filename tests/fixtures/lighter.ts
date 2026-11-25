/**
 * SYNTHETIC Lighter account: a small simulator that keeps position, entry value and realised P&L the way Lighter's
 * published Trade schema describes them, and serves them through a fake API (newest first, cursor pages).
 */
import { createLighterClient } from "@/server/lighter/client";

export const ACCT = 4242;
export const OWNER = "0x0000000000000000000000000000000000000a11";
export const SECRET = "x".repeat(40);
export const tokenFor = (account = ACCT, expiresAt = Date.UTC(2030, 0, 1), scope = "single") =>
  `ro:${account}:${scope}:${Math.floor(expiresAt / 1000)}:${"ab".repeat(8)}`;
export const USDC = 3;
export const T0 = Date.UTC(2026, 10, 25, 1);
export const MIN = 60_000;
type Row = Record<string, unknown>;

export function simLighter() {
  let tid = 43_000_000_000;
  let oid = 562_950_000_000_000;
  const pos = new Map<string, { size: number; quote: number }>();
  const trades: Row[] = [];
  const r = (n: number) => Number(n.toFixed(8));
  /** one fill of ours; `omit` drops zero fields as the API may */
  const fill = (
    side: "buy" | "sell",
    sz: number,
    px: number,
    t: number,
    o: {
      symbol?: string;
      market?: number;
      maker?: boolean;
      order?: number;
      takerFee?: number;
      type?: string;
    } = {},
  ) => {
    const symbol = o.symbol ?? "BTC";
    const p = pos.get(symbol) ?? { size: 0, quote: 0 };
    const isAsk = side === "sell";
    const delta = isAsk ? -sz : sz;
    const before = { ...p };
    let pnl = 0;
    if (p.size !== 0 && Math.sign(p.size) !== Math.sign(delta)) {
      const units = Math.min(Math.abs(p.size), sz);
      const entry = p.quote / Math.abs(p.size);
      pnl = (px - entry) * units * Math.sign(p.size);
      const left = r(p.size + delta);
      if (left === 0) Object.assign(p, { size: 0, quote: 0 });
      else if (Math.sign(left) === Math.sign(p.size))
        Object.assign(p, { size: left, quote: entry * Math.abs(left) });
      else Object.assign(p, { size: left, quote: px * Math.abs(left) });
    } else Object.assign(p, { size: r(p.size + delta), quote: p.quote + sz * px });
    pos.set(symbol, p);
    const maker = !!o.maker;
    const role = maker ? "maker" : "taker";
    const mine = o.order ?? ++oid;
    const row: Row = {
      trade_id: ++tid,
      tx_hash: `tx${tid}`,
      type: o.type ?? "trade",
      ...(o.market === 0 ? {} : { market_id: o.market ?? 1 }),
      market_symbol: symbol,
      market_kind: "perps",
      size: String(sz),
      price: String(px),
      usd_amount: (sz * px).toFixed(6),
      ask_id_str: isAsk ? String(mine) : "1",
      bid_id_str: isAsk ? "1" : String(mine),
      ask_account_id: isAsk ? ACCT : 7,
      bid_account_id: isAsk ? 7 : ACCT,
      ...(isAsk === maker ? { is_maker_ask: true } : {}), // false is left out
      timestamp: t,
      ...(before.size !== 0
        ? {
            [`${role}_position_size_before`]: String(before.size),
            [`${role}_entry_quote_before`]: before.quote.toFixed(6),
          }
        : {}),
      ...(pnl !== 0 ? { [isAsk ? "ask_account_pnl" : "bid_account_pnl"]: pnl.toFixed(6) } : {}),
      ...(o.takerFee ? { taker_fee: o.takerFee } : {}),
    };
    trades.push(row);
    return { pnl, order: mine, row };
  };
  return { fill, trades, pos };
}

export type FakeLighter = {
  trades: Row[];
  active: Row[];
  inactive: Row[];
  fundings: Row[];
  deposits: Row[];
  withdraws: Row[];
  transfers: Row[];
  collateral: string;
  mode: number;
  positions: Row[];
  markets: Row[];
  /** the client's own clock (its market list is cached for a day) */
  clock: number;
  calls: { path: string; query: URLSearchParams; auth: string | null }[];
  /** answer this path with this status */
  fail: Record<string, number>;
  pageSize: number;
  badCursor: boolean;
};

export function fakeLighter(init: Partial<FakeLighter> = {}) {
  const st: FakeLighter = {
    trades: [],
    active: [],
    inactive: [],
    fundings: [],
    deposits: [],
    withdraws: [],
    transfers: [],
    collateral: "0",
    mode: 0,
    positions: [],
    clock: T0,
    markets: [
      { symbol: "BTC", market_id: 1, market_type: "perp" },
      { symbol: "ETH", market_type: "perp" },
    ],
    calls: [],
    fail: {},
    pageSize: 100,
    badCursor: false,
    ...init,
  };
  const page = (rows: Row[], q: URLSearchParams) => {
    const from = Number(q.get("cursor") ?? 0);
    const slice = rows.slice(from, from + st.pageSize);
    return { slice, next: from + st.pageSize < rows.length ? String(from + st.pageSize) : "" };
  };
  const desc = (rows: Row[], k: string) => [...rows].sort((a, b) => Number(b[k]) - Number(a[k]));
  const fetchImpl = (async (url: string, req: { headers?: Record<string, string> }) => {
    const u = new URL(url);
    const path = u.pathname.replace("/api/v1/", "");
    const q = u.searchParams;
    const auth = req.headers?.Authorization ?? null;
    st.calls.push({ path, query: q, auth });
    if (st.fail[path]) return new Response("no", { status: st.fail[path] });
    const isPublic = ["account", "orderBooks", "assetDetails"].includes(path);
    if (!isPublic && !auth?.startsWith(`ro:${q.get("account_index")}:`))
      return new Response("{}", { status: 401 });
    let body: unknown;
    switch (path) {
      case "trades": {
        if (st.badCursor && q.get("cursor")) return new Response("{}", { status: 400 });
        const p = page(desc(st.trades, "trade_id"), q);
        body = { code: 200, trades: p.slice, next_cursor: p.next };
        break;
      }
      case "accountActiveOrders":
        body = { code: 200, orders: st.active };
        break;
      case "accountInactiveOrders": {
        if (st.badCursor && q.get("cursor")) return new Response("{}", { status: 400 });
        const [a, b] = q.get("between_timestamps")!.split("-").map(Number);
        const p = page(
          st.inactive.filter((o) => Number(o.created_at) >= a && Number(o.created_at) <= b),
          q,
        );
        body = { code: 200, orders: p.slice, next_cursor: p.next };
        break;
      }
      case "positionFunding": {
        const [a, b] = [Number(q.get("start_timestamp")), Number(q.get("end_timestamp"))];
        const p = page(
          desc(
            st.fundings.filter((f) => Number(f.timestamp) * 1000 >= a && Number(f.timestamp) * 1000 <= b),
            "timestamp",
          ),
          q,
        );
        body = { code: 200, position_fundings: p.slice, next_cursor: p.next };
        break;
      }
      case "deposit/history":
        body = { code: 200, deposits: st.deposits, cursor: "" };
        break;
      case "withdraw/history":
        body = { code: 200, withdraws: st.withdraws, cursor: "" };
        break;
      case "transfer/history":
        body = { code: 200, transfers: st.transfers, cursor: "" };
        break;
      case "account":
        body = {
          code: 200,
          accounts: [
            {
              index: Number(q.get("value")),
              l1_address: OWNER,
              account_trading_mode: st.mode,
              collateral: st.collateral,
              positions: st.positions,
            },
          ],
        };
        break;
      case "orderBooks":
        body = {
          code: 200,
          order_books: st.markets,
        };
        break;
      case "assetDetails":
        body = {
          code: 200,
          asset_details: [
            { asset_id: 1, symbol: "ETH" },
            { asset_id: USDC, symbol: "USDC" },
          ],
        };
        break;
      default:
        return new Response("{}", { status: 404 });
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const client = createLighterClient({
    apiUrl: "https://lighter.test",
    fetchImpl,
    requestsPerMin: 1e9,
    sleep: async () => {},
    now: () => st.clock,
  });
  return { st, client };
}

export const order = (o: Row): Row => ({
  market_symbol: "BTC",
  market_kind: "perps",
  is_ask: true,
  type: "stop-loss",
  status: "open",
  price: "0",
  initial_base_amount: "0.5",
  reduce_only: true,
  parent_order_id: "0",
  timestamp: Math.floor(T0 / 1000),
  created_at: Math.floor(T0 / 1000),
  updated_at: Math.floor(T0 / 1000),
  ...o,
});
