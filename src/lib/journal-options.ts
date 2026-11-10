/** Fixed option lists for the Analysis / Notes tabs (editable vocab lives in the DB). */
export const REFLECTION_PROMPTS = [
  { key: "saw", label: "What did you see that made you take it?" },
  { key: "change", label: "What would you do differently?" },
  { key: "lesson", label: "One lesson for next time" },
] as const;
export type ReflectionKey = (typeof REFLECTION_PROMPTS)[number]["key"];

export const MAX_R_CHOICES = [0, 0.5, 1, 1.5, 2, 3] as const;
export const RISK_MULTIPLIERS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const;
export const MARKET_CONDITION_LABELS = { trending: "Trending", ranging: "Ranging", volatile: "Volatile", choppy: "Choppy" } as const;
export const MAX_TAGS = 20;
export const MAX_SCREENSHOTS = 20;
