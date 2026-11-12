/**
 * Scheduled sync trigger. On each cron tick, POSTs to the app's /api/sync/cron with the bearer secret,
 * repeating while the app reports more work (`done: false`, e.g. a large backfill) up to MAX_ROUNDS.
 *
 * - No public HTTP surface: fetch() returns 404, so nobody can trigger syncs through the Worker.
 * - Logs show only round number, HTTP status and `done`. Never the URL or secret.
 * - Cron invocations may run up to 15 minutes of wall-clock time; waiting on fetch doesn't use CPU time.
 */

export interface Env {
  SYNC_URL: string;
  CRON_SECRET: string;
}

// Minimal local types so this file also type-checks in the main app (no @cloudflare/workers-types needed).
type ScheduledEvent = { cron: string; scheduledTime: number };
type Ctx = { waitUntil(p: Promise<unknown>): void };

export const MAX_ROUNDS = 3; // 3 × ≤240s server budget stays well inside the 15-minute limit
export const ROUND_TIMEOUT_MS = 295_000; // just under the app's 300s function limit

export type RoundLog = { round: number; status: number | "timeout" | "network-error"; done: boolean | null };

export async function runSync(env: Env, fetchImpl: typeof fetch = fetch): Promise<RoundLog[]> {
  if (!env.SYNC_URL || !env.CRON_SECRET) throw new Error("SYNC_URL and CRON_SECRET secrets must be set (wrangler secret put …)");
  const log: RoundLog[] = [];
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let status: RoundLog["status"];
    let done: boolean | null = null;
    try {
      const res = await fetchImpl(env.SYNC_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
        signal: AbortSignal.timeout(ROUND_TIMEOUT_MS),
      });
      status = res.status;
      const body = (await res.json().catch(() => null)) as { done?: unknown } | null;
      done = typeof body?.done === "boolean" ? body.done : null;
    } catch (e) {
      status = (e as { name?: string })?.name === "TimeoutError" ? "timeout" : "network-error";
    }
    log.push({ round, status, done });
    console.log(`sync round ${round}: ${status}${done === null ? "" : done ? ", done" : ", more work"}`);
    if (status !== 200 || done !== false) break; // finished, or failed: don't hammer the app
  }
  const last = log[log.length - 1];
  if (last.status !== 200) throw new Error(`scheduled sync failed (${last.status})`); // marks the cron run as failed in Cloudflare
  return log;
}

const worker = {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: Ctx) {
    ctx.waitUntil(runSync(env));
  },
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};

export default worker;
