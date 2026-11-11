/**
 * Trades-page filters live in the URL (shareable, back-button friendly). Parsed leniently:
 * an invalid value is dropped rather than erroring the page.
 */
import { z } from "zod";
import { GRADES, TRADE_TYPES } from "../../lib/enums";
import { PERIODS } from "../../lib/periods";

export const TABS = ["all", "planned", "open", "closed", "notes"] as const;
export type Tab = (typeof TABS)[number];

export const PAGE_SIZE = 20;

/** Built-in quick filters. (Custom saved filters: Phase 2.) */
export const CHIPS = [
  { id: "winners", label: "Recent winners", patch: { outcome: "win", period: "30d" } },
  { id: "losers", label: "Losing trades", patch: { outcome: "loss" } },
  { id: "open", label: "Open positions", patch: { tab: "open" } },
  { id: "week", label: "This week", patch: { period: "week" } },
] as const;
export type ChipId = (typeof CHIPS)[number]["id"];

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const num = z.coerce.number().finite();

const FilterSchema = z.object({
  tab: z.enum(TABS).catch("all"),
  q: z.string().trim().max(100).optional().catch(undefined),
  pair: z.string().trim().max(40).optional().catch(undefined),
  dir: z.enum(["long", "short"]).optional().catch(undefined),
  outcome: z.enum(["win", "loss", "be"]).optional().catch(undefined),
  strategy: z.string().max(64).optional().catch(undefined),
  grade: z.enum(GRADES).optional().catch(undefined),
  session: z.string().max(40).optional().catch(undefined),
  type: z.enum(TRADE_TYPES).optional().catch(undefined),
  period: z.enum(PERIODS).optional().catch(undefined),
  from: date.optional().catch(undefined),
  to: date.optional().catch(undefined),
  /** Which timestamp from/to apply to. Default entry; the P&L calendar links use exit (realised day). */
  dateBy: z.enum(["entry", "exit"]).optional().catch(undefined),
  minR: num.optional().catch(undefined),
  maxR: num.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

export type TradeFilters = z.infer<typeof FilterSchema>;
type RawParams = Record<string, string | string[] | undefined>;

export function parseFilters(params: RawParams): TradeFilters {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s !== undefined && s !== "") flat[k] = s;
  }
  return FilterSchema.parse(flat);
}

/** The filter keys shown as removable pills and counted on the Filters button. */
export const FILTER_KEYS = ["pair", "dir", "outcome", "strategy", "grade", "session", "type", "period", "from", "to", "minR", "maxR"] as const;

export function activeFilterCount(f: TradeFilters) {
  return FILTER_KEYS.filter((k) => f[k] !== undefined).length;
}

/** Build a /trades URL from filters plus a patch. Changing anything but the page resets to page 1. */
export function tradesHref(f: Partial<TradeFilters>, patch: Partial<Record<keyof TradeFilters, unknown>> = {}) {
  const next: Record<string, unknown> = { ...f, ...patch };
  if (!("page" in patch)) delete next.page;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "tab" && v === "all") continue;
    if (k === "page" && Number(v) <= 1) continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `/trades?${qs}` : "/trades";
}

/** A chip is active when all of its patch values are present in the filters. */
export function chipActive(f: TradeFilters, chip: (typeof CHIPS)[number]) {
  return Object.entries(chip.patch).every(([k, v]) => f[k as keyof TradeFilters] === v);
}

export function toggleChipHref(f: TradeFilters, chip: (typeof CHIPS)[number]) {
  if (chipActive(f, chip)) {
    const off = Object.fromEntries(Object.keys(chip.patch).map((k) => [k, k === "tab" ? "all" : undefined]));
    return tradesHref(f, off);
  }
  return tradesHref(f, chip.patch);
}
