import path from "node:path";
import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";

const tradeCount = async (text: string) => Number(/(\d+) closed trades?/.exec(text)?.[1] ?? NaN);

test.describe("Dashboard (demo data)", () => {
  test("KPIs, equity curve, recent trades and calendar render; periods and R mode switch", async ({
    page,
  }) => {
    await page.goto("/dashboard?period=all");
    const net = page.getByTestId("kpi-net");
    await expect(net).toContainText("Net P&L, all time");
    const all = await tradeCount(await net.innerText());
    expect(all).toBeGreaterThan(100);
    await expect(page.getByTestId("equity-chart").locator("svg.recharts-surface")).toBeVisible();
    await expect(page.getByTestId("recent-trades").getByRole("link")).toHaveCount(7);
    await expect(page.getByTestId("kpi-winrate")).toContainText(/\d+ won, \d+ lost, \d+ even/);

    await page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "7D" }).click();
    await expect(page).toHaveURL(/period=7d/);
    await expect(net).toContainText("Net P&L, 7 days");
    expect(await tradeCount(await net.innerText())).toBeLessThan(all);

    await page.getByRole("navigation", { name: "Units" }).getByRole("link", { name: "R" }).click();
    await expect(page).toHaveURL(/unit=r/);
    await expect(net).toContainText("Total R, 7 days");
    await expect(net).toContainText(/[+-]?\d+\.\d{2}R/);
  });

  test("with full ledger history the $ curve is the account balance; balance − net deposited reconciles to the cent", async ({
    page,
  }) => {
    await page.goto("/dashboard?period=all");
    const chart = page.getByRole("region", { name: "Equity curve" });
    await expect(chart.getByRole("heading", { name: "Account balance" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Account balance and net deposits over time" })).toBeVisible();
    const usd = async (loc: ReturnType<typeof page.getByTestId>) =>
      Number((await loc.innerText()).replace(/[^0-9.-]/g, ""));
    const balance = await usd(page.getByTestId("balance-now"));
    const deposited = await usd(page.getByTestId("balance-deposited"));
    const kpiNet = await usd(page.getByTestId("kpi-net").locator("div").nth(1));

    // expected figures straight from the seeded demo database (plain SQL, not the app's query code)
    const db = createClient({ url: `file:${path.resolve("data/demo/journal.db")}` });
    const one = async (sql: string) => Number((await db.execute(sql)).rows[0][0] ?? 0);
    const flows = await one("select sum(usd) from ledger_events");
    // every fill's closedPnl − fee: a fee in a non-stable token (the spot buy pays PURR) is valued at the fill price;
    // spot fills count because the demo wallet is a unified account
    const fillCash =
      await one(`select sum(cast(closed_pnl as real) - case when upper(fee_token) in ('USDC','USDH','USDT0','USDT','USDE')
      then cast(fee as real) else cast(fee as real) * cast(px as real) end) from fills`);
    const spotCash = await one(
      "select sum(cast(closed_pnl as real)) - sum(case when fee_token = 'USDC' then cast(fee as real) else cast(fee as real) * cast(px as real) end) from fills where market_type = 'spot'",
    );
    const funding = await one("select sum(cast(usdc as real)) from funding_events");
    // the parts of that cash the all-time KPI net doesn't hold: open positions, funding no trade claims, spot fills
    const openCash = await one(
      "select sum(coalesce(gross_pnl,0) - coalesce(fees,0) + funding) from trades where status = 'open' and deleted_at is null",
    );
    const unclaimedFunding = await one(
      "select sum(cast(usdc as real)) from funding_events where trade_id is null",
    );
    const hiddenCash = await one(
      "select sum(coalesce(gross_pnl,0) - coalesce(fees,0) + funding) from trades where status = 'closed' and (deleted_at is not null or coalesce(json_extract(flags, '$.superseded'), 0) = 1)",
    );
    db.close();
    const cents = (x: number) => Math.round(x * 100);

    expect(spotCash).toBeCloseTo(300 - 3.5 * 0.2 - 1.035, 6); // the seeded spot round trip
    expect(cents(deposited)).toBe(cents(flows));
    expect(cents(flows)).toBe(2_624_900); // +25,000 +5,000 −3,001 −750
    expect(cents(balance)).toBe(cents(flows + fillCash + funding));
    // reconciliation: balance − net deposited = KPI net + open positions' realised cash + unclaimed funding
    // + spot fills + hidden trades. Each side is rounded once, so allow a 1-cent rounding step.
    const gap = cents(balance) - cents(deposited);
    expect(
      Math.abs(gap - cents(kpiNet + openCash + unclaimedFunding + spotCash + hiddenCash)),
    ).toBeLessThanOrEqual(1);

    // privacy mode blurs both figures
    await page.getByRole("button", { name: "Hide amounts" }).click();
    await expect(page.getByTestId("balance-now")).toHaveCSS("filter", /blur/);
    await expect(page.getByTestId("balance-deposited")).toHaveCSS("filter", /blur/);
    await page.getByRole("button", { name: "Show amounts" }).click();

    // R mode keeps cumulative R
    await page.goto("/dashboard?period=all&unit=r");
    await expect(chart.getByRole("heading", { name: "Cumulative R" })).toBeVisible();
    await expect(page.getByTestId("balance-now")).toHaveCount(0);
    // the hero headlines cumulative R, never the $ equity
    // (over All time the curve's cumulative R and the KPI's total R cover the same trades)
    const totalR = await page.getByTestId("kpi-net").locator("div").nth(1).innerText();
    expect(totalR).toMatch(/R$/);
    await expect(page.getByTestId("hero-figure")).toHaveText(totalR);
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
    await expect(page).toHaveURL(
      /\/trades\?tab=closed&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&dateBy=exit/,
    );
    await expect(page.getByRole("link", { name: /Exited from/ })).toBeVisible();
    await expect(page.getByTestId("trade-row")).toHaveCount(trades);
  });

  test("open positions banner lists the open trades (live P&L off for demo)", async ({ page }) => {
    await page.goto("/trades?tab=open");
    const openCount = Number(
      await page
        .getByRole("link", { name: /^Open \d+/ })
        .locator("span")
        .innerText(),
    );
    await page.goto("/dashboard");
    const banner = page.getByTestId("open-banner");
    await expect(banner).toContainText(`${openCount} open position`);
    await expect(banner).toContainText("live P&L unavailable for demo data");
    await banner.getByRole("button").first().click();
    await expect(banner.getByRole("link", { name: "Journal" })).toHaveCount(openCount);
  });

  test("custom date range", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Custom" }).click();
    await page.getByLabel("From").fill("2026-09-01");
    await page.getByLabel("To (optional)").fill("2026-09-30");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/period=custom&from=2026-09-01&to=2026-09-30/);
    await expect(page.getByTestId("kpi-net")).toContainText("2026-09-01 to 2026-09-30");
  });
});
