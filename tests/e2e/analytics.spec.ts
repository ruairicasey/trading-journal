import { expect, test } from "@playwright/test";

test.describe("Analytics: Setup (demo data)", () => {
  test("widgets render with sample sizes; table view; R mode; periods stay on /analytics", async ({ page }) => {
    await page.goto("/analytics");
    await expect(page.getByTestId("analytics-summary")).toContainText("closed trades · All");
    const grade = page.getByTestId("widget-grade");
    await expect(grade.getByText("A+", { exact: true })).toBeVisible();
    await grade.getByRole("button", { name: "Table view" }).click();
    await expect(grade.getByRole("columnheader", { name: "Win rate" })).toBeVisible();
    await expect(grade.getByRole("row")).not.toHaveCount(1);

    await page.getByRole("link", { name: "R", exact: true }).click();
    await expect(page).toHaveURL(/\/analytics\?.*unit=r/);
    await expect(page.getByTestId("widget-pair")).toContainText("avg R");

    await page.getByRole("link", { name: "30D" }).click();
    await expect(page).toHaveURL(/\/analytics\?.*period=30d/);
    await expect(page.getByTestId("analytics-summary")).toContainText("30D");
  });

  test("hiding a widget persists; the Widgets menu brings it back", async ({ page }) => {
    await page.goto("/analytics");
    await page.getByTestId("widget-direction").getByRole("button", { name: "Hide Long vs short" }).click();
    await expect(page.getByTestId("widget-direction")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("widget-direction")).toHaveCount(0);
    await page.getByRole("button", { name: /Widgets \(1 hidden\)/ }).click();
    await page.getByRole("checkbox").nth(1).click();
    await expect(page.getByTestId("widget-direction")).toBeVisible();
  });

  test("Timing tab: six widgets, hold averages, and the section survives period / unit changes", async ({ page }) => {
    await page.goto("/analytics");
    await page.getByRole("link", { name: "Timing" }).click();
    await expect(page).toHaveURL(/section=timing/);
    for (const id of ["weekday", "hour", "session", "hold", "nth-of-day", "gap"]) await expect(page.getByTestId(`widget-${id}`)).toBeVisible();
    await expect(page.getByTestId("widget-weekday").getByText("Mon", { exact: true })).toBeVisible();
    await expect(page.getByTestId("hold-avg")).toContainText(/winners \d/);
    await expect(page.getByTestId("session-hours")).toContainText("New York 08:00–16:00 New York time");
    await expect(page.getByTestId("widget-gap")).toContainText("First trade");
    await page.getByRole("link", { name: "R", exact: true }).click();
    await expect(page).toHaveURL(/section=timing/);
    await page.getByRole("link", { name: "Year" }).click();
    await expect(page).toHaveURL(/period=year/);
    await expect(page).toHaveURL(/section=timing/);
    await expect(page.getByTestId("analytics-summary")).toContainText("by entry time");
  });

  test("Risk & execution tab: risk size vs typical risk, how trades ended, loser and capture footers", async ({ page }) => {
    await page.goto("/analytics?section=risk");
    for (const id of ["risk-size", "risk-multiplier", "sl-reason", "tp-reason", "exit-by", "loser-max-r", "capture", "retests", "rules", "process"])
      await expect(page.getByTestId(`widget-${id}`)).toBeVisible();
    await expect(page.getByTestId("typical-risk")).toContainText("Typical (median) risk $");
    const ended = page.getByTestId("widget-exit-by");
    await expect(ended.getByText("Take-profit order", { exact: true })).toBeVisible();
    await expect(ended.getByText("Stop order", { exact: true })).toBeVisible();
    await expect(page.getByTestId("losers-1r")).toContainText("were 1R+ in profit");
    await expect(page.getByTestId("avg-capture")).toContainText("of the max R reached");
    // privacy mode blurs the typical-risk amount like every other $ figure
    await expect(page.getByTestId("typical-risk").locator(".money")).toHaveCount(1);
  });
});
