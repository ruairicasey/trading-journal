import { expect, test } from "@playwright/test";

const cents = (s: string) => Math.round(Number(s.replace(/[^0-9.-]/g, "")) * 100);
const csvRows = (text: string) => text.replace(/^﻿/, "").trimEnd().split("\r\n");

test("Reports: totals match the dashboard, every table adds up, CSVs reconcile", async ({ page }) => {
  await page.goto("/dashboard?period=all");
  const dashNet = cents(await page.getByTestId("kpi-net").locator("div").nth(1).innerText());

  await page.goto("/reports");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: /Trading report, this month/ })).toBeVisible();
  await expect(page.getByTestId("export-trades")).toHaveAttribute(
    "href",
    /^\/api\/export\/trades\.csv\?at=\d+$/,
  );
  await expect(page.getByRole("navigation", { name: "Units" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "All" }).click();
  await expect(page).toHaveURL(/period=all/);
  await expect(page.getByTestId("export-trades")).toHaveAttribute(
    "href",
    /^\/api\/export\/trades\.csv\?period=all&at=\d+$/,
  );

  const net = cents(await page.getByTestId("report-net").innerText());
  expect(net).toBe(dashNet);
  const count = Number((await page.getByTestId("report-count").innerText()).match(/(\d+)/)![1]);
  await expect(page.getByTestId("report-meta")).toContainText(`${count} closed trades`);

  // each breakdown's rows add up to the total, in trades and net
  for (const id of ["report-months", "report-pairs", "report-dirs"]) {
    const t = page.getByTestId(id);
    const rows = t.getByTestId("report-row");
    const n = (await rows.locator("td:nth-child(2)").allInnerTexts()).reduce((a, x) => a + Number(x), 0);
    expect(n, id).toBe(count);
    const nets = await t
      .locator("[data-net]")
      .evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-net"))));
    expect(Math.abs(Math.round(nets.reduce((a, x) => a + x, 0) * 100) - net), id).toBeLessThanOrEqual(1);
  }
  await expect(page.getByTestId("report-trades").getByTestId("report-row")).toHaveCount(count);

  // CSVs: same trades, same net
  const res = await page.request.get("/api/export/trades.csv?period=all");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(res.headers()["content-disposition"]).toMatch(
    /attachment; filename="journal-trades-all-\d{4}-\d{2}-\d{2}\.csv"/,
  );
  expect(res.headers()["cache-control"]).toContain("no-store");
  const lines = csvRows(await res.text());
  expect(lines).toHaveLength(count + 1);
  const monthly = csvRows(await (await page.request.get("/api/export/monthly.csv?period=all")).text());
  const head = monthly[0].split(",");
  const body = monthly.slice(1).map((l) => l.split(","));
  expect(body.reduce((a, r) => a + Number(r[head.indexOf("trades")]), 0)).toBe(count);
  expect(
    Math.abs(Math.round(body.reduce((a, r) => a + Number(r[head.indexOf("net_pnl")]), 0) * 100) - net),
  ).toBeLessThanOrEqual(body.length);
  expect(body).toHaveLength(await page.getByTestId("report-months").getByTestId("report-row").count());

  expect((await page.request.get("/api/export/other.csv")).status()).toBe(404);

  // a 30-day report: the page's link (pinned to when it was built) downloads exactly the trades on the page
  await page.goto("/reports?period=30d");
  const n30 = await page.getByTestId("report-trades").getByTestId("report-row").count();
  const href = (await page.getByTestId("export-trades").getAttribute("href"))!;
  expect(href).toMatch(/period=30d&at=\d+/);
  expect(csvRows(await (await page.request.get(href)).text())).toHaveLength(n30 + 1);
});

test("Reports is in the sidebar and the print button is there; print styles hide the app around the report", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Reports" }).first().click();
  await expect(page).toHaveURL(/\/reports/);
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: "Print / Save as PDF" })).toBeHidden();
  await expect(page.locator('[data-slot="sidebar"]').first()).toBeHidden();
  await expect(page.getByRole("heading", { name: /Trading report/ })).toBeVisible();
});
