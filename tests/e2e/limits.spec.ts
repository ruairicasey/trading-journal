import { expect, test, type Page } from "@playwright/test";

async function setLimits(page: Page, v: { loss: string; trades: string; streak: string }) {
  await page.goto("/settings/accounts");
  const form = page.locator("form").first();
  await form.locator('input[name="dailyLossLimit"]').fill(v.loss);
  await form.locator('input[name="maxTradesPerDay"]').fill(v.trades);
  await form.locator('input[name="maxLossStreak"]').fill(v.streak);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByText("Saved")).toBeVisible();
}

test.describe("Risk rules (demo data)", () => {
  test.afterEach(async ({ page }) => setLimits(page, { loss: "", trades: "", streak: "" }));

  test("with no rules there is no Today card, no limits insight and no limits check", async ({ page }) => {
    await page.goto("/dashboard?period=all");
    await expect(page.getByTestId("weekly-card")).toBeVisible();
    await expect(page.getByTestId("limits-card")).toHaveCount(0);
    await page.goto("/analytics?section=insights&period=all");
    await expect(page.getByTestId("scores")).toBeVisible();
    await expect(page.locator('[data-insight="limits"]')).toHaveCount(0);
    await expect(page.getByTestId("check-within-limits")).toHaveCount(0);
  });

  test("rules show today's card; the limits insight and the discipline check reconcile", async ({ page }) => {
    await setLimits(page, { loss: "250", trades: "1", streak: "2" });
    // saved values come back on reload
    await page.reload();
    await expect(page.locator('input[name="maxTradesPerDay"]').first()).toHaveValue("1");

    await page.goto("/dashboard?period=all");
    const card = page.getByTestId("limits-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("limits-loss")).toContainText("of");
    await expect(card.getByTestId("limits-trades")).toContainText("of 1");
    await expect(card.getByTestId("limits-streak")).toContainText("of 2");
    await expect(card.getByTestId("limits-state")).toHaveText(
      /Within your limits|Close to a limit|Stop for today/,
    );

    await page.goto("/analytics?section=insights&period=all");
    const scoresCard = page.getByTestId("scores");
    const check = scoresCard.getByTestId("check-within-limits");
    await expect(check).toBeVisible();
    const reviewed = await scoresCard.getByTestId("score-reviewed").innerText(); // "Reviewed x of N"
    const total = Number(/of (\d+)/.exec(reviewed)![1]);
    const withinPct = Number(/(\d+)%/.exec(await check.innerText())![1]);
    // with one trade a day allowed, the demo's busy days break the rule
    const insight = page.locator('[data-insight="limits"]');
    if ((await insight.count()) > 0) {
      const broke = Number(/\d+/.exec(await insight.getByTestId("insight-n").innerText())![0]);
      expect(withinPct).toBe(Math.round(((total - broke) / total) * 100));
    } else {
      // the pattern made money, so it isn't a leak; the check still counts it
      expect(withinPct).toBeLessThan(100);
    }
  });

  test("a fractional trade cap is refused and nothing is saved", async ({ page }) => {
    await page.goto("/settings/accounts");
    const form = page.locator("form").first();
    const input = form.locator('input[name="maxTradesPerDay"]');
    await input.fill("2.5");
    await form.getByRole("button", { name: "Save" }).click();
    expect(await input.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
    await page.reload();
    await expect(page.locator('input[name="maxTradesPerDay"]').first()).toHaveValue("");
  });
});
