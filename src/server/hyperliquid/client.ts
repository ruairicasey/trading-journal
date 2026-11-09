/**
 * Read-only Hyperliquid info API client. Only ever needs a wallet address — never a key.
 *
 * Rate limits (docs, verified 2026-11-09): 1200 weight/min per IP. clearinghouseState = 2,
 * other info requests = 20, and fills/funding responses add +1 per 20 items returned.
 * We stay under a configurable budget (default 900/min) with a token bucket.
 */
import type { z } from "zod";
import {
  ClearinghouseStateSchema,
  FillsSchema,
  FundingSchema,
  PerpDexsSchema,
  type HlClearinghouseState,
  type HlFill,
  type HlFunding,
} from "./schemas";

export class HlApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HlApiError";
  }
}

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class WeightLimiter {
  private tokens: number;
  private last: number;
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = realSleep,
  ) {
    this.tokens = perMinute;
    this.last = now();
  }
  private refill() {
    const t = this.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((t - this.last) / 60_000) * this.perMinute);
    this.last = t;
  }
  /** Wait until `weight` is available, then consume it. */
  async take(weight: number) {
    this.refill();
    while (this.tokens < weight) {
      const needMs = ((weight - this.tokens) / this.perMinute) * 60_000;
      await this.sleep(Math.ceil(needMs));
      this.refill();
    }
    this.tokens -= weight;
  }
  /** Charge weight after the fact (per-item extra weight); may go negative → next take() waits. */
  charge(weight: number) {
    this.refill();
    this.tokens -= weight;
  }
  get available() {
    this.refill();
    return this.tokens;
  }
}

export type HlClientOptions = {
  apiUrl: string;
  fetchImpl?: typeof fetch;
  weightBudgetPerMin?: number;
  timeoutMs?: number;
  retries?: number;
  sleep?: Sleep;
  now?: () => number;
};

export function createHlClient(opts: HlClientOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? realSleep;
  const limiter = new WeightLimiter(opts.weightBudgetPerMin ?? 900, opts.now, sleep);
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const retries = opts.retries ?? 4;
  const url = opts.apiUrl.replace(/\/+$/, "") + "/info";
  let dexCache: { at: number; names: string[] } | null = null;

  async function post<S extends z.ZodTypeAny>(
    body: Record<string, unknown>,
    schema: S,
    weight: { base: number; perItems?: number },
  ): Promise<z.infer<S>> {
    const type = String(body.type);
    let attempt = 0;
    for (;;) {
      await limiter.take(weight.base);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response | undefined;
      let networkError = false;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch {
        networkError = true;
      } finally {
        clearTimeout(timer);
      }

      const retryable = networkError || res!.status === 429 || res!.status >= 500;
      if (retryable) {
        if (attempt >= retries) {
          // Never include the request body (it contains the address) in errors.
          throw new HlApiError(
            networkError ? `${type}: network error after ${attempt + 1} attempts` : `${type}: HTTP ${res!.status}`,
            res?.status,
          );
        }
        await sleep(1000 * 2 ** attempt);
        attempt++;
        continue;
      }
      if (!res!.ok) throw new HlApiError(`${type}: HTTP ${res!.status}`, res!.status);

      const json: unknown = await res!.json();
      if (weight.perItems && Array.isArray(json)) limiter.charge(Math.floor(json.length / weight.perItems));
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new HlApiError(`${type}: unexpected response shape at ${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
      }
      return parsed.data;
    }
  }

  return {
    limiter,
    /** Ascending by time; ≤2000 per call; startTime/endTime inclusive; only the 10k most recent fills exist. */
    userFillsByTime(user: string, startTime: number, endTime?: number): Promise<HlFill[]> {
      return post({ type: "userFillsByTime", user, startTime, ...(endTime ? { endTime } : {}) }, FillsSchema, {
        base: 20,
        perItems: 20,
      });
    },
    /** ≤500 per call; paginate by last timestamp. Includes HIP-3 coins. */
    userFunding(user: string, startTime: number, endTime?: number): Promise<HlFunding[]> {
      return post({ type: "userFunding", user, startTime, ...(endTime ? { endTime } : {}) }, FundingSchema, {
        base: 20,
        perItems: 20,
      });
    },
    clearinghouseState(user: string, dex = ""): Promise<HlClearinghouseState> {
      return post({ type: "clearinghouseState", user, ...(dex ? { dex } : {}) }, ClearinghouseStateSchema, { base: 2 });
    },
    /** Names of builder-deployed perp dexes (the first, unnamed dex is ""), cached for 24h. */
    async perpDexNames(): Promise<string[]> {
      const now = (opts.now ?? Date.now)();
      if (dexCache && now - dexCache.at < 86_400_000) return dexCache.names;
      const list = await post({ type: "perpDexs" }, PerpDexsSchema, { base: 20 });
      const names = ["", ...list.filter((d): d is NonNullable<typeof d> => d !== null).map((d) => d.name)];
      dexCache = { at: now, names };
      return names;
    },
  };
}

export type HlClient = ReturnType<typeof createHlClient>;
