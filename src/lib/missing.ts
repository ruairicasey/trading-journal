/**
 * "Missing context": journal gaps on CLOSED trades. One definition (the SQL in queries/trades.ts) backs both
 * the weekly reflection counts and the `missing=` trades filter, so a count always matches its link.
 */
export const MISSING_KINDS = ["review", "stop", "process", "exit", "mistakes", "emotions"] as const;
export type MissingKind = (typeof MISSING_KINDS)[number];

export const MISSING_LABELS: Record<MissingKind, { short: string; long: string }> = {
  review: { short: "Not reviewed", long: "no review yet (post-trade notes, rules, exit reason, process or mistakes)" },
  stop: { short: "No stop loss", long: "no stop loss, so no R" },
  process: { short: "Process not marked", long: "process compliance not marked" },
  exit: { short: "No exit reason", long: "no exit reason" },
  mistakes: { short: "Rules broken, no mistake tagged", long: "rules partly or not followed, but no mistake tagged" },
  emotions: { short: "Emotions missing", long: "emotion before or after not set" },
};
