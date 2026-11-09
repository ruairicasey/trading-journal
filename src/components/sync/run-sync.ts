import type { SyncStatus } from "@/server/db/queries/sync";

export type SyncResponse = {
  done: boolean;
  results: { label: string; status: string; fillsNew: number; tradesTouched: number; gapsDetected: number; error?: string }[];
  status: SyncStatus;
};

/**
 * Call /api/sync, repeating while the server reports more work (resumable backfill/funding chunks).
 * Stops after `maxRounds` so a broken server can't spin forever.
 */
export async function runSync(
  body: { trigger: "manual" | "auto" | "range"; walletId?: string; range?: { start: number; end: number } },
  onProgress?: (r: SyncResponse, round: number) => void,
  maxRounds = 30,
): Promise<SyncResponse> {
  let last: SyncResponse | null = null;
  for (let round = 1; round <= maxRounds; round++) {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(round === 1 ? body : { ...body, range: undefined, trigger: body.trigger === "range" ? "manual" : body.trigger }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error ?? `Sync failed (HTTP ${res.status})`);
    last = json as SyncResponse;
    onProgress?.(last, round);
    const skippedOnly = last.results.length > 0 && last.results.every((r) => r.status === "skipped");
    if (last.done || skippedOnly || last.results.some((r) => r.status === "error")) break;
  }
  return last!;
}
