/**
 * zod schemas for Lighter's read API (docs.lighter.xyz/api, read 2026-11-25; see docs/lighter.md).
 * "Fields with zero or empty values may be omitted", so everything that can be zero is optional.
 */
import { z } from "zod";

const num = z
  .string()
  .transform((s) => s.trim())
  .refine((s) => s !== "" && Number.isFinite(Number(s)), { message: "expected a numeric string" });
/** zero and empty values may be left out of a response */
const num0 = num.optional().default("0");
const false0 = z.boolean().optional().default(false);
/** a 64-bit order id as its decimal string: the plain number is rounded by JSON.parse above 2^53 */
const idStr = z.string().regex(/^\d{1,20}$/);
/** ids that stay small (trade and account ids): refuse one that JSON.parse would round */
const id = z
  .number()
  .int()
  .refine((n) => Number.isSafeInteger(n), { message: "id too large for a JS number" });
const cursor = z.string().nullish();

export const TradeSchema = z
  .object({
    trade_id: id,
    tx_hash: z.string(),
    type: z.string(), // trade | liquidation | deleverage | market-settlement
    market_symbol: z.string().min(1),
    market_kind: z.string(), // perps | spot | bo
    size: num,
    price: num,
    usd_amount: num,
    ask_id_str: idStr.optional(),
    bid_id_str: idStr.optional(),
    ask_account_id: id,
    bid_account_id: id,
    is_maker_ask: false0,
    timestamp: z.number().int(), // ms
    taker_fee: z.number().int().optional(),
    maker_fee: z.number().int().optional(),
    taker_position_size_before: num.optional(),
    maker_position_size_before: num.optional(),
    taker_entry_quote_before: num.optional(),
    maker_entry_quote_before: num.optional(),
    ask_account_pnl: num.optional(),
    bid_account_pnl: num.optional(),
    integrator_taker_fee: z.number().int().optional(),
    integrator_maker_fee: z.number().int().optional(),
  })
  .passthrough();
export type LtTrade = z.infer<typeof TradeSchema>;
export const TradesSchema = z
  .object({ trades: z.array(TradeSchema).nullish(), next_cursor: cursor })
  .passthrough();

export const OrderSchema = z
  .object({
    order_id: idStr,
    market_symbol: z.string().min(1),
    market_kind: z.string(),
    is_ask: false0,
    type: z.string(),
    status: z.string(),
    price: num0,
    trigger_price: z.string().optional(),
    initial_base_amount: z.string().optional(),
    reduce_only: z.boolean().optional(),
    parent_order_id: z.string().optional(),
    order_version: z.number().optional(),
    timestamp: z.number().int(),
    created_at: z.number().int().optional(),
    updated_at: z.number().int().optional(),
  })
  .passthrough();
export type LtOrder = z.infer<typeof OrderSchema>;
export const OrdersSchema = z
  .object({ orders: z.array(OrderSchema).nullish(), next_cursor: cursor })
  .passthrough();

export const FundingSchema = z
  .object({
    timestamp: z.number().int(), // seconds
    market_id: z.number().int().optional().default(0),
    funding_id: z.number().int(),
    change: num0,
    rate: num0,
    position_size: num0,
    position_side: z.enum(["long", "short"]),
  })
  .passthrough();
export type LtFunding = z.infer<typeof FundingSchema>;
export const FundingsSchema = z
  .object({ position_fundings: z.array(FundingSchema).nullish(), next_cursor: cursor })
  .passthrough();

export const DepositSchema = z
  .object({
    id: z.string(),
    amount: num,
    timestamp: z.number().int(),
    status: z.string(),
    l1_tx_hash: z.string().optional(),
    asset_id: z.number().int(),
  })
  .passthrough();
export const DepositsSchema = z.object({ deposits: z.array(DepositSchema).nullish(), cursor }).passthrough();
export const WithdrawSchema = z
  .object({
    id: z.string(),
    amount: num,
    timestamp: z.number().int(),
    status: z.string(),
    type: z.string().optional(),
    l2_tx_hash: z.string().optional(),
    asset_id: z.number().int(),
  })
  .passthrough();
export const WithdrawsSchema = z
  .object({ withdraws: z.array(WithdrawSchema).nullish(), cursor })
  .passthrough();
export const TransferSchema = z
  .object({
    id: z.string(),
    amount: num,
    timestamp: z.number().int(),
    type: z.string(),
    tx_hash: z.string().optional(),
    asset_id: z.number().int(),
    fee: z.string().optional(),
    from_account_index: z.number().optional(),
    to_account_index: z.number().optional(),
    from_route: z.string().optional(),
    to_route: z.string().optional(),
  })
  .passthrough();
export const TransfersSchema = z
  .object({ transfers: z.array(TransferSchema).nullish(), cursor })
  .passthrough();
export type LtDeposit = z.infer<typeof DepositSchema>;
export type LtWithdraw = z.infer<typeof WithdrawSchema>;
export type LtTransfer = z.infer<typeof TransferSchema>;

export const PositionSchema = z
  .object({
    symbol: z.string(),
    sign: z.number().int().optional().default(0),
    position: num0,
    avg_entry_price: num.optional(),
    position_value: num.optional(),
    unrealized_pnl: num.optional(),
    liquidation_price: z.string().optional(),
    initial_margin_fraction: z.string().optional(), // percent: "20.00" = 5x
    total_funding_paid_out: z.string().optional(),
  })
  .passthrough();
export type LtPosition = z.infer<typeof PositionSchema>;
export const AccountSchema = z
  .object({
    index: id,
    l1_address: z.string(),
    account_trading_mode: z.number().int().optional(), // 0 classic, 1 unified
    collateral: num0,
    total_asset_value: z.string().optional(),
    positions: z.array(PositionSchema).nullish(),
  })
  .passthrough();
export type LtAccount = z.infer<typeof AccountSchema>;
export const AccountsSchema = z.object({ accounts: z.array(AccountSchema).nullish() }).passthrough();

export const MarketsSchema = z
  .object({
    order_books: z.array(
      z.object({ symbol: z.string(), market_id: z.number().int().optional().default(0) }).passthrough(),
    ),
  })
  .passthrough();
export const AssetsSchema = z
  .object({
    asset_details: z.array(z.object({ asset_id: z.number().int(), symbol: z.string() }).passthrough()),
  })
  .passthrough();

/** documented page size maximum for every paged endpoint */
export const PAGE_LIMIT = 100;
