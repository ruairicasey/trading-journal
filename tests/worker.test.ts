import { describe, expect, test, vi } from "vitest";
import worker, { MAX_ROUNDS, runSync } from "../workers/sync-cron/src/index";

const env = { SYNC_URL: "https://app.example/api/sync/cron", CRON_SECRET: ["fake", "test", "token"].join("-") }; // synthetic
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Cloudflare Worker sync trigger", () => {
  test("posts once with the bearer secret when the app reports done", async () => {
    const f = vi.fn(async () => reply(200, { ok: true, done: true }));
    const log = await runSync(env, f as unknown as typeof fetch);
    expect(log).toEqual([{ round: 1, status: 200, done: true }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(env.SYNC_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${env.CRON_SECRET}`);
  });

  test("repeats while there is more work, up to MAX_ROUNDS", async () => {
    const f = vi.fn(async () => reply(200, { ok: true, done: false }));
    const log = await runSync(env, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(MAX_ROUNDS);
    expect(log.every((l) => l.done === false)).toBe(true);
  });

  test("stops and fails the run on an error status (no retries hammering the app)", async () => {
    const f = vi.fn(async () => reply(401, { error: "Unauthorized" }));
    await expect(runSync(env, f as unknown as typeof fetch)).rejects.toThrow(/failed \(401\)/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test("never logs the URL or secret", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runSync(env, (async () => reply(200, { done: true })) as unknown as typeof fetch);
    const out = spy.mock.calls.flat().join(" ");
    expect(out).not.toContain(env.SYNC_URL);
    expect(out).not.toContain(env.CRON_SECRET);
    spy.mockRestore();
  });

  test("refuses to run without secrets; public fetch handler is a 404", async () => {
    await expect(runSync({ SYNC_URL: "", CRON_SECRET: "" })).rejects.toThrow(/secrets must be set/);
    expect((await worker.fetch()).status).toBe(404);
  });
});
