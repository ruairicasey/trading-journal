/**
 * npm run screenshots — regenerate the README screenshots in docs/screenshots/ from the SYNTHETIC demo
 * account only. Seeds data/demo, starts the app against it on 127.0.0.1, captures pages, stops the server.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { applyDemoEnv, DEMO_DB_FILE } from "./demo-env";

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve("docs/screenshots");

async function waitFor(url: string, ms = 180_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function main() {
  const env = applyDemoEnv({ ...process.env });
  const seed = spawnSync("npx", ["tsx", "scripts/seed-demo.ts"], { stdio: "inherit", env });
  if (seed.status !== 0) process.exit(seed.status ?? 1);
  if (!fs.existsSync(DEMO_DB_FILE)) throw new Error("demo DB missing");

  const server = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", String(PORT)], { env, stdio: "ignore", detached: true });
  try {
    await waitFor(`${BASE}/trades`);
    fs.mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const shot = async (name: string, opts: { fullPage?: boolean } = {}) => {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
      console.log(`  docs/screenshots/${name}.png`);
    };

    // warm up dev compilation so the captures are fully rendered
    for (const p of ["/dashboard", "/trades", "/settings/journal"]) await page.goto(BASE + p);

    await page.goto(`${BASE}/dashboard?period=all`);
    await page.waitForSelector("[data-testid=equity-chart] .recharts-area-curve");
    await page.getByTestId("open-banner").getByRole("button").first().click();
    await shot("dashboard", { fullPage: true });

    await page.goto(`${BASE}/trades?tab=closed`);
    // expand a journaled trade (strategy, tags and rationale visible)
    const rows = page.getByTestId("trade-row");
    for (let i = 1; i < 12; i++) {
      await rows.nth(i).getByTestId("trade-expand").click();
      const text = await rows.nth(i).getByTestId("trade-details").innerText();
      if (text.includes("#") && !text.includes("Setup\n—")) break;
      await rows.nth(i).getByTestId("trade-expand").click();
    }
    await shot("trades");

    // a journaled trade that has a screenshot
    const { createClient } = await import("@libsql/client");
    const db = createClient({ url: `file:${DEMO_DB_FILE}` });
    const id = String((await db.execute("select s.trade_id from screenshots s join trade_journal j on j.trade_id = s.trade_id limit 1")).rows[0].trade_id);
    db.close();
    await page.goto(`${BASE}/trades/${id}`);
    const more = page.getByRole("button", { name: /More details/ });
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    await shot("edit-basic");
    await page.getByRole("tab", { name: /Analysis/ }).click();
    await shot("edit-analysis");
    await page.getByRole("tab", { name: /Notes/ }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=screenshot] img")].every((i) => (i as HTMLImageElement).naturalWidth > 0));
    await shot("edit-notes");

    await page.goto(`${BASE}/settings/journal?kind=confluence`);
    await shot("settings-journal-lists");
    await browser.close();
    console.log("Done. Review the images, then commit docs/screenshots/.");
  } finally {
    try {
      process.kill(-server.pid!, "SIGTERM");
    } catch {}
  }
}

main().catch((e) => {
  console.error("screenshots failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
