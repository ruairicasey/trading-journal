/**
 * Read-only Lighter API client. Private data needs a read-only token ("ro:…"), which cannot sign: it can't trade,
 * transfer or withdraw. The token only ever travels in the Authorization header, never in a URL or an error.
 *
 * Rate limit (docs): 60 requests per rolling minute on Standard accounts. The bucket starts full, so 28/min means at
 * most 56 requests in any minute.
 */
import type { z } from "zod";
import { WeightLimiter } from "../hyperliquid/client";
import {
  AccountsSchema,
  AssetsSchema,
  DepositsSchema,
  FundingsSchema,
  MarketsSchema,
  OrdersSchema,
  PAGE_LIMIT,
  TradesSchema,
  TransfersSchema,
  WithdrawsSchema,
  type LtAccount,
} from "./schemas";

export class LighterApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LighterApiError";
  }
}

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));
type Auth = { token: string; account: number };
type Query = Record<string, string | number | undefined>;

export type LighterClientOptions = {
  apiUrl: string;
  fetchImpl?: typeof fetch;
  requestsPerMin?: number;
  timeoutMs?: number;
  retries?: number;
  sleep?: Sleep;
  now?: () => number;
};

const DAY = 86_400_000;

export function createLighterClient(opts: LighterClientOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const limiter = new WeightLimiter(opts.requestsPerMin ?? 28, opts.now, sleep);
  const base = opts.apiUrl.replace(/\/+$/, "") + "/api/v1/";
  const retries = opts.retries ?? 1;
  let markets: { at: number; map: Map<number, string> } | null = null;
  let usdc: { at: number; id: number } | null = null;

  async function get<S extends z.ZodTypeAny>(
    path: string,
    query: Query,
    schema: S,
    token?: string,
    /** one short try outside the limiter: for a page that is waiting, never for sync */
    quick = false,
  ): Promise<z.infer<S>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") qs.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      if (!quick) await limiter.take(1);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), quick ? 5_000 : (opts.timeoutMs ?? 10_000));
      let res: Response | undefined;
      let json: unknown;
      try {
        res = await fetchImpl(`${base}${path}?${qs}`, {
          headers: token ? { Authorization: token } : {},
          signal: ctrl.signal,
          redirect: "error", // never carry the token to another host
        });
        if (res.ok) json = await res.json();
      } catch {
        res = undefined;
      } finally {
        clearTimeout(timer);
      }
      // 429 and 405 are both documented rate-limit answers
      if (!res || res.status === 429 || res.status === 405 || res.status >= 500) {
        if (quick || attempt >= retries) {
          const limited = res?.status === 429 || res?.status === 405;
          throw new LighterApiError(
            !res
              ? `${path}: network error`
              : limited
                ? `${path}: rate limited, will retry next sync`
                : `${path}: HTTP ${res.status}`,
            res?.status,
          );
        }
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      // never include the URL (account index, address) or the server's message: either may echo private values
      if (!res.ok) throw new LighterApiError(`${path}: HTTP ${res.status}`, res.status);
      const code = (json as { code?: unknown } | null)?.code;
      if (typeof code === "number" && code !== 200 && code !== 0)
        throw new LighterApiError(`${path}: error code ${code}`, 400);
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new LighterApiError(
          `${path}: unexpected response shape at ${issue?.path.join(".") || "(root)"}: ${issue?.message}`,
        );
      }
      return parsed.data;
    }
  }

  return {
    /** Newest first; `cursor` continues. Perp, spot and binary-option fills: the caller keeps perps. */
    async trades(a: Auth, cursor?: string | null) {
      const r = await get(
        "trades",
        {
          account_index: a.account,
          sort_by: "timestamp",
          sort_dir: "desc",
          limit: PAGE_LIMIT,
          cursor: cursor ?? undefined,
        },
        TradesSchema,
        a.token,
      );
      return { rows: r.trades ?? [], next: r.next_cursor || null };
    },
    /** Orders that are no longer live, in a time window (ms). */
    async inactiveOrders(a: Auth, w: { start: number; end: number }, cursor?: string | null) {
      const between = `${Math.floor(w.start / 1000)}-${Math.ceil(w.end / 1000)}`;
      const r = await get(
        "accountInactiveOrders",
        {
          account_index: a.account,
          limit: PAGE_LIMIT,
          between_timestamps: between,
          cursor: cursor ?? undefined,
        },
        OrdersSchema,
        a.token,
      );
      return { rows: r.orders ?? [], next: r.next_cursor || null };
    },
    async activeOrders(a: Auth) {
      const r = await get("accountActiveOrders", { account_index: a.account }, OrdersSchema, a.token);
      return r.orders ?? [];
    },
    async fundings(a: Auth, w: { start: number; end: number }, cursor?: string | null) {
      const r = await get(
        "positionFunding",
        {
          account_index: a.account,
          limit: PAGE_LIMIT,
          start_timestamp: w.start,
          end_timestamp: w.end,
          cursor: cursor ?? undefined,
        },
        FundingsSchema,
        a.token,
      );
      return { rows: r.position_fundings ?? [], next: r.next_cursor || null };
    },
    async deposits(a: Auth, l1Address: string, cursor?: string | null) {
      const r = await get(
        "deposit/history",
        { account_index: a.account, l1_address: l1Address, filter: "all", cursor: cursor ?? undefined },
        DepositsSchema,
        a.token,
      );
      return { rows: r.deposits ?? [], next: r.cursor || null };
    },
    async withdrawals(a: Auth, cursor?: string | null) {
      const r = await get(
        "withdraw/history",
        { account_index: a.account, filter: "all", cursor: cursor ?? undefined },
        WithdrawsSchema,
        a.token,
      );
      return { rows: r.withdraws ?? [], next: r.cursor || null };
    },
    async transfers(a: Auth, cursor?: string | null) {
      const r = await get(
        "transfer/history",
        { account_index: a.account, type: "all", cursor: cursor ?? undefined },
        TransfersSchema,
        a.token,
      );
      return { rows: r.transfers ?? [], next: r.cursor || null };
    },
    /** Public by index: positions, collateral and the wallet that owns the account. */
    async account(index: number, o: { quick?: boolean } = {}): Promise<LtAccount> {
      const r = await get("account", { by: "index", value: index }, AccountsSchema, undefined, o.quick);
      const acc = (r.accounts ?? []).find((x) => x.index === index);
      if (!acc) throw new LighterApiError("account: not found", 404);
      return acc;
    },
    /** market_id → symbol, cached for a day. */
    async markets(o: { fresh?: boolean } = {}): Promise<Map<number, string>> {
      if (!o.fresh && markets && now() - markets.at < DAY) return markets.map;
      const r = await get("orderBooks", {}, MarketsSchema);
      markets = { at: now(), map: new Map(r.order_books.map((b) => [b.market_id, b.symbol])) };
      return markets.map;
    },
    async usdcAssetId(): Promise<number> {
      if (usdc && now() - usdc.at < DAY) return usdc.id;
      const r = await get("assetDetails", {}, AssetsSchema);
      const a = r.asset_details.find((x) => x.symbol.toUpperCase() === "USDC");
      if (!a) throw new LighterApiError("assetDetails: no USDC asset");
      usdc = { at: now(), id: a.asset_id };
      return usdc.id;
    },
  };
}
export type LighterClient = ReturnType<typeof createLighterClient>;
export type LighterAuth = Auth;
