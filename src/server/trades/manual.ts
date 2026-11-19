/**
 * Manual trade entry: a trade you type in (another venue, or one sync can't see). Fully user-owned; its figures are
 * computed from what you entered with the same maths the Edit form uses on save. Sync never touches manual trades.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { displayPair, parseCoin } from "../hyperliquid/markets";
import { manualMetrics } from "../../lib/trade-math";

const num = z.number().finite();
const price = num.positive().max(1e12);

export const ManualTradeSchema = z.object({
  coin: z.string().trim().min(1).max(40),
  direction: z.enum(s.DIRECTIONS),
  status: z.enum(s.TRADE_STATUSES),
  entry: price.nullable(),
  exit: price.nullable(),
  size: num.positive().max(1e15).nullable(),
  fees: num.min(-1e6).max(1e6).nullable(),
  stopLoss: price.nullable(),
  entryTime: z.number().int().min(0).nullable(),
  exitTime: z.number().int().min(0).nullable(),
});
export type ManualTradeInput = z.infer<typeof ManualTradeSchema>;

export type CreateResult = { ok: true; id: string } | { ok: false; errors: Record<string, string> };

/**
 * Normalise what people type for a Hyperliquid-style account: "btc", "BTC/USD" and "btc-perp" are the BTC perp;
 * "xyz:spx" is xyz:SPX; "kPEPE" keeps the lowercase k prefix (typed that way); "@107" and spot pairs with a quote
 * other than USD are kept as spot.
 */
export function normaliseCoin(raw: string) {
  // keep Hyperliquid's 1000x prefix only when typed as such ("kPEPE"): "kas" is KAS, not kAS
  const upper = (b: string) => (/^k[A-Z0-9]{2,}$/.test(b) ? b : b.toUpperCase());
  const c = raw.trim().replace(/\s+/g, "");
  const i = c.indexOf(":");
  if (i >= 0) return `${c.slice(0, i).toLowerCase()}:${upper(c.slice(i + 1))}`;
  const base = c.replace(/[-/](USD|PERP)$/i, "");
  if (base.includes("/") || base.startsWith("@")) return base.toUpperCase();
  return upper(base);
}

const HL_COIN = /^(?:[a-z0-9]+:k?[A-Z0-9]+|@\d+|[A-Za-z0-9]+\/[A-Z0-9]+|k?[A-Z0-9]+)$/;
const CFD_SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._#]{0,29}$/;

export type ManualMarket = Pick<typeof s.trades.$inferInsert, "coin" | "displayPair" | "dex" | "marketType">;

/**
 * The stored market for a manual trade. Crypto accounts use Hyperliquid's naming (so manual and synced trades of a
 * coin group together); prop and other accounts store the symbol as cTrader names it ("EUR/USD" is EURUSD), as a CFD,
 * matching cTrader-synced trades. null when nothing usable was typed. resolveMarket also reuses a spelling the
 * account already has.
 */
export function manualMarket(
  raw: string,
  accountType: (typeof s.accounts.$inferSelect)["type"],
): ManualMarket | null {
  if (accountType !== "crypto") {
    // brokers' symbols can be mixed case (US30.cash): keep what was typed, but "eurusd" means EURUSD
    const typed = raw.trim().replace(/[\s/-]+/g, "");
    const sym = typed === typed.toLowerCase() ? typed.toUpperCase() : typed;
    return CFD_SYMBOL.test(sym) ? { coin: sym, displayPair: sym, dex: "", marketType: "cfd" } : null;
  }
  const coin = normaliseCoin(raw);
  if (!HL_COIN.test(coin)) return null;
  const p = parseCoin(coin);
  return { coin, displayPair: displayPair(coin), dex: p.dex, marketType: p.marketType };
}

export function validateManual(m: ManualTradeInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (m.status !== "planned" && m.entry === null) errors.entry = "Enter the entry price";
  if (m.status !== "planned" && m.entryTime === null) errors.entryTime = "Enter when you opened it";
  if (m.status === "closed") {
    if (m.exit === null) errors.exit = "Enter the exit price";
    if (m.size === null) errors.size = "Enter the size";
    if (m.exitTime === null) errors.exitTime = "Enter when you closed it";
    else if (m.entryTime !== null && m.exitTime < m.entryTime)
      errors.exitTime = "Exit time is before entry time";
  }
  if (m.stopLoss !== null && m.entry !== null) {
    const wrongSide = m.direction === "long" ? m.stopLoss >= m.entry : m.stopLoss <= m.entry;
    if (wrongSide)
      errors.stopLoss = `A ${m.direction}'s stop must be ${m.direction === "long" ? "below" : "above"} the entry`;
  }
  return errors;
}

export async function createManualTrade(
  db: DB,
  accountId: string,
  raw: unknown,
  now = Date.now(),
): Promise<CreateResult> {
  const parsed = ManualTradeSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, errors: { form: `${issue.path.join(".") || "input"}: ${issue.message}` } };
  }
  const m = parsed.data;
  if (m.entryTime !== null && m.entryTime > now + 60_000)
    return { ok: false, errors: { entryTime: "Entry time is in the future" } };
  if (m.exitTime !== null && m.exitTime > now + 60_000)
    return { ok: false, errors: { exitTime: "Exit time is in the future" } };
  const errors = validateManual(m);
  if (Object.keys(errors).length) return { ok: false, errors };

  const account = await db.query.accounts.findFirst({
    where: and(eq(s.accounts.id, accountId), eq(s.accounts.archived, false)),
  });
  if (!account) return { ok: false, errors: { form: "No account" } };
  const market = await resolveMarket(db, accountId, m.coin, account.type);
  if (!market) return { ok: false, errors: { coin: "Enter a pair, like BTC or EURUSD" } };

  const closed = m.status === "closed";
  const id = nanoid();
  await db.transaction(async (tx) => {
    await tx.insert(s.trades).values({
      id,
      accountId,
      walletId: null,
      source: "manual",
      externalKey: null,
      ...market,
      direction: m.direction,
      status: m.status,
      fillCount: 0,
      flags: {},
      ...manualMetrics({
        direction: m.direction,
        entry: m.entry,
        exit: closed ? m.exit : null,
        size: m.size,
        fees: m.fees,
        entryTime: m.status === "planned" ? null : m.entryTime,
        exitTime: closed ? m.exitTime : null,
        closed,
      }),
    });
    await tx.insert(s.tradeJournal).values({
      tradeId: id,
      manualEntry: m.entry,
      manualExit: closed ? m.exit : null,
      manualSize: m.size,
      manualEntryTime: m.status === "planned" ? null : m.entryTime,
      manualExitTime: closed ? m.exitTime : null,
      feeOverride: m.fees,
      stopLoss: m.stopLoss,
      stopLossSource: m.stopLoss !== null ? "user" : null,
      sizeMode: "position",
      tradeType: m.status === "planned" ? "planned" : null,
      updatedAt: now,
    });
  });
  return { ok: true, id };
}

/**
 * manualMarket, then the account's own spelling if it already trades that market under another case (kpepe → kPEPE,
 * US30.CASH → US30.cash), so the Pairs breakdown keeps one row per instrument.
 */
export async function resolveMarket(
  db: DB,
  accountId: string,
  raw: string,
  accountType: (typeof s.accounts.$inferSelect)["type"],
): Promise<ManualMarket | null> {
  const m = manualMarket(raw, accountType);
  if (!m) return null;
  const [known] = await db
    .select({
      coin: s.trades.coin,
      displayPair: s.trades.displayPair,
      dex: s.trades.dex,
      marketType: s.trades.marketType,
    })
    .from(s.trades)
    .where(
      and(
        eq(s.trades.accountId, accountId),
        sql`lower(${s.trades.coin}) = lower(${m.coin})`,
        isNull(s.trades.deletedAt),
      ),
    )
    .orderBy(desc(s.trades.createdAt))
    .limit(1);
  return known ?? m;
}
