import { expect, test, type Page } from "@playwright/test";

async function setGoals(page: Page, v: { net: string; trades: string; review: string }) {
  await page.goto("/settings/accounts");
  const form = page.locator("form").first();
  await form.locator('input[name="goalMonthlyNet"]').fill(v.net);
  await form.locator('input[name="goalMonthlyTrades"]').fill(v.trades);
  await form.locator('input[name="goalReviewPct"]').fill(v.review);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByText("Saved")).toBeVisible();
}

test.describe("Monthly goals (demo data)", () => {
  test.afterEach(async ({ page }) => setGoals(page, { net: "", trades: "", review: "" }));

  test("no goals, no card; goals show this month and the last months' record", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("weekly-card")).toBeVisible();
    await expect(page.getByTestId("goals-card")).toHaveCount(0);

    await setGoals(page, { net: "1000", trades: "30", review: "50" });
    await page.reload();
    await expect(page.locator('input[name="goalMonthlyTrades"]').first()).toHaveValue("30");

    await page.goto("/dashboard");
    const card = page.getByTestId("goals-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("goal-net")).toContainText("of");
    await expect(card.getByTestId("goal-net-state")).toHaveText(/Met|On pace|Behind pace/);
    await expect(card.getByTestId("goal-trades")).toContainText("of 30");
    await expect(card.getByTestId("goal-review")).toContainText("target 50%");
    await expect(card.getByTestId("goals-days-left")).toHaveText(/\d+ days? left/);
    await expect(card.getByTestId("goals-history")).toHaveText(
      /Last (month|\d months): net \d+ of \d+, trades \d+ of \d+, reviews \d+ of \d+ hit\.|once a full month/,
    );

    // the counts match this month's closed trades on the Trades page (the month as the app sees it, in its timezone)
    const month = (await card.getAttribute("data-month"))!;
    const [, reviewed, closed] = /(\d+) of (\d+)/
      .exec(await card.getByTestId("goal-review").innerText())!
      .map(Number);
    const base = `/trades?tab=closed&dateBy=exit&from=${month}-01`;
    const count = async (href: string) => {
      await page.goto(href);
      const shown = page.getByTestId("trades-showing");
      return (await shown.count()) ? Number(/of (\d+)/.exec(await shown.innerText())![1]) : 0;
    };
    expect(await count(base)).toBe(closed);
    expect(await count(`${base}&missing=review`)).toBe(closed - reviewed);
  });

  test("only one goal set shows only that row", async ({ page }) => {
    await setGoals(page, { net: "", trades: "", review: "80" });
    await page.goto("/dashboard");
    const card = page.getByTestId("goals-card");
    await expect(card.getByTestId("goal-review")).toBeVisible();
    await expect(card.getByTestId("goal-net")).toHaveCount(0);
    await expect(card.getByTestId("goal-trades")).toHaveCount(0);
  });
});
