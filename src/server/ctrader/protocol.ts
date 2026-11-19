/**
 * cTrader Open API JSON messages (port 5036). Payload type numbers and fields are from Spotware's official
 * .proto files (github.com/spotware/openapi-proto-messages). The JSON envelope is
 * { clientMsgId, payloadType, payload }; responses echo clientMsgId.
 *
 * Parsing is lenient where the docs are silent: int64 may arrive as a number or a numeric string, enums as their
 * number or their name. Money is an integer scaled by 10^moneyDigits; volumes are in cents (units × 100).
 */
import { z } from "zod";

export const HOSTS = {
  live: "wss://live.ctraderapi.com:5036",
  demo: "wss://demo.ctraderapi.com:5036",
} as const;

export const PT = {
  ERROR_RES: 50,
  HEARTBEAT_EVENT: 51,
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  ASSET_LIST_REQ: 2112,
  ASSET_LIST_RES: 2113,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  TRADER_REQ: 2121,
  TRADER_RES: 2122,
  DEAL_LIST_REQ: 2133,
  DEAL_LIST_RES: 2134,
  OA_ERROR_RES: 2142,
  ACCOUNTS_TOKEN_INVALIDATED_EVENT: 2147,
  CLIENT_DISCONNECT_EVENT: 2148,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_REQ: 2149,
  GET_ACCOUNTS_BY_ACCESS_TOKEN_RES: 2150,
  ACCOUNT_DISCONNECT_EVENT: 2164,
} as const;

const int = z.union([z.number(), z.string().regex(/^-?\d+$/)]).transform((v) => Number(v));
const enumOf = <T extends Record<string, number>>(names: T) =>
  z.union([z.number(), z.string()]).transform((v) => (typeof v === "number" ? v : (names[v] ?? Number(v))));

export const TRADE_SIDE = { BUY: 1, SELL: 2 } as const;
export const DEAL_STATUS = {
  FILLED: 2,
  PARTIALLY_FILLED: 3,
  REJECTED: 4,
  INTERNALLY_REJECTED: 5,
  ERROR: 6,
  MISSED: 7,
} as const;
export const SCOPE = { SCOPE_VIEW: 0, SCOPE_TRADE: 1 } as const;

export const CtidAccount = z.object({
  ctidTraderAccountId: int,
  isLive: z.boolean().optional(),
  traderLogin: int.optional(),
  lastClosingDealTimestamp: int.optional(),
  brokerTitleShort: z.string().optional(),
});
export const AccountsByTokenRes = z.object({
  permissionScope: enumOf(SCOPE).optional(),
  ctidTraderAccount: z.array(CtidAccount).default([]),
});

export const TraderRes = z.object({
  trader: z.object({
    ctidTraderAccountId: int,
    balance: int,
    depositAssetId: int,
    moneyDigits: z.number().optional(),
    traderLogin: int.optional(),
    brokerName: z.string().optional(),
    registrationTimestamp: int.optional(),
  }),
});

export const AssetListRes = z.object({
  asset: z
    .array(z.object({ assetId: int, name: z.string(), displayName: z.string().optional() }))
    .default([]),
});

export const SymbolsListRes = z.object({
  symbol: z.array(z.object({ symbolId: int, symbolName: z.string().optional() })).default([]),
  archivedSymbol: z.array(z.object({ symbolId: int, name: z.string().optional() })).default([]),
});

export const Deal = z.object({
  dealId: int,
  orderId: int,
  positionId: int,
  volume: int,
  filledVolume: int,
  symbolId: int,
  createTimestamp: int.optional(),
  executionTimestamp: int,
  executionPrice: z.number().optional(),
  tradeSide: enumOf(TRADE_SIDE),
  dealStatus: enumOf(DEAL_STATUS),
  commission: int.optional(),
  baseToUsdConversionRate: z.number().optional(),
  moneyDigits: z.number().optional(),
  closePositionDetail: z
    .object({
      entryPrice: z.number(),
      grossProfit: int,
      swap: int,
      commission: int,
      balance: int,
      closedVolume: int.optional(),
      moneyDigits: z.number().optional(),
      pnlConversionFee: int.optional(),
    })
    .optional(),
});
export type RawDeal = z.infer<typeof Deal>;
export const DealListRes = z.object({ deal: z.array(Deal).default([]), hasMore: z.boolean().optional() });

export const ErrorRes = z.object({
  errorCode: z.union([z.string(), z.number()]).transform(String),
  description: z.string().optional(),
});

/** Error codes that mean the grant is gone: the owner must reconnect. */
export const TOKEN_ERRORS = new Set(["OA_AUTH_TOKEN_EXPIRED", "CH_ACCESS_TOKEN_INVALID", "1", "104"]);
