import type { ClosedTrade } from "../stats";

export type AnalyticsTrade = ClosedTrade & {
  coin: string;
  tradeType: "planned" | "reactive" | null;
  /** session you picked on the trade (null = not set; Timing falls back to your session hours) */
  session: string | null;
  grade: string | null;
  strategyId: string | null;
  strategy: string | null;
  /** higher-timeframe confluences (journal) */
  htf: string[];
  confluences: { id: string; label: string }[];
};

/** One bucket of a breakdown (a bar / a table row). */
export type Bucket = {
  key: string;
  label: string;
  n: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** wins / (wins + losses); null with no decided trades */
  winRate: number | null;
  net: number;
  avgTrade: number | null;
  /** R only from trades with a stop */
  rCount: number;
  avgR: number | null;
  totalR: number | null;
  /** below the minimum sample size: shown greyed, never ranked as "best" */
  small: boolean;
};

export type Breakdown = { id: string; buckets: Bucket[]; total: number; minN: number };

export const DEFAULT_MIN_N = 5;
