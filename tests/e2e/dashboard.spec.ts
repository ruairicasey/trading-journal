import { expect, test } from "@playwright/test";

const tradeCount = async (text: string) => Number(/(\d+) closed trades?/.exec(text)?.[1] ?? NaN);

test.describe("Dashboard (demo data)", () => {
  test("KPIs, equity curve, recent trades and calendar render; periods and R mode switch", async ({ page }) => {
    await page.goto("/dashboard?period=all");
    const net = page.getByTestId("kpi-net");
    await expect(net).toContainText("Net P&L · All");
    const all = await tradeCount(await net.innerText());
    expect(all).toBeGreaterThan(100);
    await expect(page.getByTestId("equity-chart").locator("svg.recharts-surface")).toBeVisible();
    await expect(page.getByTestId("recent-trades").getByRole("link")).toHaveCount(7);
    await expect(page.getByTestId("kpi-winrate")).toContainText(/\d+W \/ \d+L \/ \d+BE/);

    await page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "7D" }).click();
    await expect(page).toHaveURL(/period=7d/);
    await expect(net).toContainText("Net P&L · 7D");
    expect(await tradeCount(await net.innerText())).toBeLessThan(all);

    await page.getByRole("navigation", { name: "Units" }).getByRole("link", { name: "R" }).click();
    await expect(page).toHaveURL(/unit=r/);
    await expect(net).toContainText("Total R · 7D");
    await expect(net).toContainText(/[+-]?\d+\.\d{2}R/);
  });

  test("privacy toggle blurs money everywhere and is remembered", async ({ page }) => {
    await page.goto("/dashboard?period=all");
    await page.waitForLoadState("networkidle");
    const money = page.getByTestId("kpi-net").locator(".money");
    await expect(money).toHaveCSS("filter", "none");
    const yTick = page.getByTestId("equity-chart").locator(".recharts-yAxis-tick-labels text").first();
    await expect(yTick).toBeVisible();
    await page.getByRole("button", { name: "Hide amounts" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-privacy", "on");
    await expect(money).toHaveCSS("filter", /blur/);
    await expect(yTick).toHaveCSS("visibility", "hidden"); // equity-curve $ axis values hidden
    await page.goto("/trades");
    await expect(page.getByTestId("trade-row").first().locator(".money").first()).toHaveCSS("filter", /blur/);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-privacy", "on");
    await page.getByRole("button", { name: "Show amounts" }).click();
    await expect(page.getByTestId("trade-row").first().locator(".money").first()).toHaveCSS("filter", "none");
  });

  test("calendar navigates months and a day links to that day's trades", async ({ page }) => {
    await page.goto("/dashboard?period=all");
    const cal = page.getByTestId("pnl-calendar");
    const title = await cal.getByTestId("calendar-month").innerText();
    await cal.getByRole("link", { name: "Previous month" }).click();
    await expect(cal.getByTestId("calendar-month")).not.toHaveText(title);
    await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
    const day = cal.getByTestId("calendar-day").first();
    const trades = Number(/(\d+) trades?/.exec(await day.innerText())?.[1]);
    await day.click();
    await expect(page).toHaveURL(/\/trades\?tab=closed&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&dateBy=exit/);
    await expect(page.getByRole("link", { name: /Exited from/ })).toBeVisible();
    await expect(page.getByTestId("trade-row")).toHaveCount(trades);
  });

  test("open positions banner lists the open trades (live P&L off for demo)", async ({ page }) => {
    await page.goto("/trades?tab=open");
    const openCount = Number(await page.getByRole("link", { name: /^Open \d+/ }).locator("span").innerText());
    await page.goto("/dashboard");
    const banner = page.getByTestId("open-banner");
    await expect(banner).toContainText(`${openCount} open position`);
    await expect(banner).toContainText("live P&L unavailable for demo data");
    await banner.getByRole("button").first().click();
    await expect(banner.getByRole("link", { name: "Journal →" })).toHaveCount(openCount);
  });

  test("custom date range", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Custom" }).click();
    await page.getByLabel("From").fill("2026-09-01");
    await page.getByLabel("To (optional)").fill("2026-09-30");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/period=custom&from=2026-09-01&to=2026-09-30/);
    await expect(page.getByTestId("kpi-net")).toContainText("2026-09-01 → 2026-09-30");
  });
});
