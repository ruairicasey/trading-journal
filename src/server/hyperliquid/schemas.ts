/**
 * zod schemas for the Hyperliquid info API (verified 2026-11-09, see docs/hyperliquid.md).
 * All strings are trimmed: the official examples include values like " USDC" and " -3.625312".
 */
import { z } from "zod";

const str = z.string().transform((s) => s.trim());
/** numeric string, trimmed and checked */
const num = str.refine((s) => s !== "" && Number.isFinite(Number(s)), { message: "expected a numeric string" });

export const FillSchema = z
  .object({
    coin: str,
    px: num,
    sz: num,
    side: z.enum(["B", "A"]),
    time: z.number().int(),
    startPosition: num,
    dir: str,
    closedPnl: num,
    hash: str,
    oid: z.number().int(),
    crossed: z.boolean(),
    fee: num, // total fee, inclusive of builderFee
    tid: z.number().int(),
    feeToken: str,
    builderFee: num.optional().nullable(), // absent when 0
    liquidation: z.unknown().optional().nullable(),
    twapId: z.number().int().optional().nullable(),
  })
  .passthrough();
export type HlFill = z.infer<typeof FillSchema>;
export const FillsSchema = z.array(FillSchema);

export const PerpDexsSchema = z.array(z.object({ name: str }).passthrough().nullable());

const PositionSchema = z
  .object({
    coin: str,
    szi: num,
    entryPx: num.nullable().optional(),
    positionValue: num.optional(),
    unrealizedPnl: num.optional(),
    returnOnEquity: num.optional(),
    liquidationPx: num.nullable().optional(),
    marginUsed: num.optional(),
    leverage: z.object({ type: str, value: z.number() }).passthrough().optional(),
    cumFunding: z.object({ allTime: num, sinceChange: num, sinceOpen: num }).passthrough().optional(),
  })
  .passthrough();

export const ClearinghouseStateSchema = z
  .object({
    assetPositions: z.array(z.object({ position: PositionSchema, type: str.optional() }).passthrough()),
    marginSummary: z
      .object({ accountValue: num, totalNtlPos: num, totalRawUsd: num, totalMarginUsed: num })
      .passthrough(),
    withdrawable: num.optional(),
    time: z.number().int(),
  })
  .passthrough();
export type HlClearinghouseState = z.infer<typeof ClearinghouseStateSchema>;
export type HlPosition = z.infer<typeof PositionSchema>;

export const FundingEntrySchema = z
  .object({
    time: z.number().int(),
    hash: str,
    delta: z
      .object({
        type: z.literal("funding"),
        coin: str,
        usdc: num,
        szi: num,
        fundingRate: num,
        nSamples: z.number().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type HlFunding = z.infer<typeof FundingEntrySchema>;
export const FundingSchema = z.array(FundingEntrySchema);

/** Page sizes documented by Hyperliquid. */
export const FILLS_PAGE_LIMIT = 2000;
export const FILLS_HISTORY_LIMIT = 10_000;
export const TIME_RANGE_PAGE_LIMIT = 500;
