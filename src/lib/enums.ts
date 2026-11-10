/** Fixed enumerations shared by the schema, server code and client components (no DB imports). */
export const ACCOUNT_TYPES = ["crypto", "prop", "other"] as const;
export const WALLET_KINDS = ["main", "sub", "vault"] as const;
export const TRADE_SOURCES = ["hyperliquid", "manual"] as const;
export const TRADE_STATUSES = ["planned", "open", "closed"] as const;
export const DIRECTIONS = ["long", "short"] as const;
export const MARKET_TYPES = ["perp", "hip3", "spot"] as const;
export const GRADES = ["A+", "A", "B", "C", "D"] as const;
export const TIMEFRAME_CLASSES = ["LTF", "MTF", "HTF"] as const;
export const TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "6H", "12H", "1D", "3D", "1W", "1M"] as const;
export const HTF_TIMEFRAMES = ["30m", "1H", "2H", "4H", "6H", "12H", "1D", "3D", "1W", "1M"] as const;
export const MARKET_CONDITIONS = ["trending", "ranging", "volatile", "choppy"] as const;
export const TRADE_TYPES = ["planned", "reactive"] as const;
export const RULES_FOLLOWED = ["yes", "partial", "no"] as const;
export const SIZE_MODES = ["position", "risk"] as const;
export const VOCAB_KINDS = [
  "strategy",
  "confluence",
  "sl_reason",
  "tp_reason",
  "checklist",
  "exit_reason",
  "mistake",
  "emotion",
] as const;
export type VocabKind = (typeof VOCAB_KINDS)[number];
