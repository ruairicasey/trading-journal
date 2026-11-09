/**
 * Default journal vocabulary — a STARTING POINT. Every item is editable in Settings → Journal lists.
 * VWAP / volume-profile oriented, plus generic categories. No personal data here.
 */
import type { VocabKind } from "./schema";

type SeedList = { category?: string; items: string[] }[];

export const SEED_VOCAB: Record<VocabKind, SeedList> = {
  strategy: [
    {
      items: [
        "VWAP reversion",
        "VWAP trend continuation",
        "Value area rotation",
        "Value area breakout",
        "Range deviation",
        "Breakout & retest",
        "Liquidity sweep reversal",
      ],
    },
  ],

  confluence: [
    {
      category: "VWAP",
      items: [
        "Session VWAP",
        "Anchored VWAP (swing)",
        "Anchored VWAP (event)",
        "Weekly VWAP",
        "Monthly VWAP",
        "VWAP 1σ band",
        "VWAP 2σ band",
        "VWAP 3σ band",
        "VWAP reclaim",
        "VWAP rejection",
        "Band deviation & reversion",
      ],
    },
    {
      category: "Volume Profile / TPO",
      items: [
        "POC",
        "VAH",
        "VAL",
        "Naked POC",
        "Developing POC",
        "Prior day POC",
        "Prior day VAH",
        "Prior day VAL",
        "Prior week value area",
        "HVN",
        "LVN",
        "Single prints",
        "Poor high / poor low",
        "Composite profile level",
        "80% rule (VA rotation)",
      ],
    },
    {
      category: "Order Flow",
      items: [
        "CVD divergence",
        "Absorption",
        "Delta flip",
        "Large prints",
        "Open interest build",
        "OI flush",
        "Funding extreme",
        "Liquidation cascade",
        "Stacked imbalances",
        "Exhaustion",
      ],
    },
    {
      category: "Market Structure",
      items: [
        "HTF trend aligned",
        "Break of structure",
        "Change of character",
        "Higher low",
        "Lower high",
        "Range high / low",
        "Deviation / SFP",
        "Retest of breakout",
      ],
    },
    {
      category: "Key Levels",
      items: [
        "Previous day high / low",
        "Previous week high / low",
        "Daily open",
        "Weekly open",
        "Monthly open",
        "Round number",
        "Session high / low",
      ],
    },
    {
      category: "Session / Time",
      items: ["Asia range", "London open", "New York open", "New York close", "Weekend", "Funding window"],
    },
    {
      category: "Technical",
      items: [
        "EMA confluence",
        "RSI divergence",
        "Bollinger squeeze",
        "Trendline",
        "Fib retracement",
        "Fib extension",
        "Wedge / triangle",
        "Double top / bottom",
      ],
    },
    {
      category: "SMC",
      items: [
        "Order block",
        "Fair value gap",
        "Liquidity sweep",
        "Breaker block",
        "Equal highs / lows",
        "Premium / discount",
      ],
    },
    {
      category: "Wyckoff",
      items: ["Spring", "Upthrust", "Sign of strength", "LPS / LPSY", "Accumulation", "Distribution"],
    },
    {
      category: "Fundamental",
      items: ["News catalyst", "Macro data", "Token unlock", "Listing / delisting", "BTC correlation"],
    },
  ],

  sl_reason: [
    { category: "Structure", items: ["Below swing low / above swing high", "Beyond range", "Beyond deviation wick"] },
    { category: "Volume Profile", items: ["Below VAL / above VAH", "Beyond POC", "Beyond LVN", "Beyond HVN"] },
    { category: "VWAP", items: ["Beyond VWAP band", "Beyond anchored VWAP"] },
    { category: "SMC", items: ["Beyond order block", "Beyond FVG", "Beyond sweep wick"] },
    { category: "Technical", items: ["Beyond EMA", "Beyond trendline"] },
    { category: "Risk", items: ["ATR-based", "Fixed % risk", "Max $ risk", "Time-based"] },
  ],

  tp_reason: [
    {
      category: "Structure",
      items: ["Previous high / low", "Range opposite side", "Session high / low", "Daily high / low", "Weekly high / low"],
    },
    { category: "R-multiple", items: ["1R", "2R", "3R", "4R+"] },
    {
      category: "Volume Profile",
      items: ["At POC", "At VAH", "At VAL", "Previous day POC", "Previous day value area", "Naked POC", "HVN"],
    },
    { category: "VWAP", items: ["At VWAP", "VWAP 1σ band", "VWAP 2σ band", "Anchored VWAP"] },
    { category: "Other", items: ["Trailing stop", "Liquidity pool", "Round number", "Time exit"] },
  ],

  // Editable: replace with your own A-tier criteria in Settings → Journal lists → Checklist.
  checklist: [
    {
      items: ["Checked HTF bias", "Identified key levels", "Risk calculated", "Reviewed rules", "No FOMO / revenge"],
    },
  ],

  exit_reason: [
    {
      items: [
        "TP hit",
        "SL hit",
        "Manual invalidation",
        "Early profit take",
        "Panic close",
        "Moved stop to BE",
        "Trailing stop",
        "Time exit",
        "Macro news",
        "Rule break",
        "Liquidation",
        "Other",
      ],
    },
  ],

  mistake: [
    {
      items: [
        "No stop loss",
        "Moved stop further",
        "Oversized",
        "Chased entry",
        "Early exit",
        "Late entry",
        "Revenge trade",
        "FOMO",
        "Overtrading",
        "Ignored HTF bias",
        "Traded into news",
        "Didn't follow plan",
        "Added to a loser",
      ],
    },
  ],

  emotion: [
    {
      items: ["Confident", "Neutral", "Calm", "Anxious", "FOMO", "Revenge", "Greedy", "Fearful", "Frustrated", "Euphoric"],
    },
  ],
};

export const VOCAB_KIND_LABELS: Record<VocabKind, string> = {
  strategy: "Strategies",
  confluence: "Confluences",
  sl_reason: "SL placement",
  tp_reason: "TP placement",
  checklist: "Pre-trade checklist",
  exit_reason: "Exit reasons",
  mistake: "Mistakes",
  emotion: "Emotions",
};

/** Sessions are defined in UTC hours (end exclusive, may wrap past midnight). Editable in Settings. */
export const DEFAULT_SESSIONS = [
  { name: "Asia", startUtc: 0, endUtc: 7 },
  { name: "London", startUtc: 7, endUtc: 13 },
  { name: "New York", startUtc: 13, endUtc: 20 },
  { name: "Late Night", startUtc: 20, endUtc: 24 },
];

export const DEFAULT_QUICK_FILTERS = [
  { name: "Recent Winners", query: { outcome: "win", period: "30d" } },
  { name: "Losing Trades", query: { outcome: "loss" } },
  { name: "Open Positions", query: { status: "open" } },
  { name: "This Week", query: { period: "week" } },
];
