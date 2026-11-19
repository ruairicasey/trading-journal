import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { DEMO_DB_FILE } from "../../scripts/demo-env";

async function reviewedAt(id: string): Promise<number | null> {
  const db = createClient({ url: `file:${DEMO_DB_FILE}` });
  const r = await db.execute({ sql: "select reviewed_at from trade_journal where trade_id = ?", args: [id] });
  db.close();
  return (r.rows[0]?.reviewed_at as number | null | undefined) ?? null;
}

/** Walk back from this week to one with unreviewed trades and open its review flow from the week card. */
async function openWeekReview(page: import("@playwright/test").Page) {
  for (let i = 0; i < 12; i++) {
    const day = new Date(Date.now() - i * 7 * 86_400_000).toISOString().slice(0, 10);
    await page.goto(`/dashboard?week=${day}`);
    await expect(page.getByTestId("weekly-card")).toBeVisible();
    const link = page.getByTestId("review-week");
    if ((await link.count()) > 0) {
      const n = Number(/Review the (\d+)/.exec(await link.innerText())?.[1]);
      await link.click();
      await expect(page).toHaveURL(/\/review\?/);
      return n;
    }
  }
  throw new Error("no week with unreviewed trades in the demo data");
}

test.describe("Weekly review flow (demo data)", () => {
  test("the week card's link opens a queue of exactly its unreviewed trades", async ({ page }) => {
    const n = await openWeekReview(page);
    await expect(page.getByTestId("review-progress")).toHaveText(`1 of ${n}, 0 reviewed`);
    await expect(page.getByTestId("review-scope")).toContainText("Closed");
  });

  test("save and next marks the trade reviewed, keeps grade and notes, and moves on", async ({ page }) => {
    const n = await openWeekReview(page);
    const trade = page.getByTestId("review-trade");
    const id = (await trade.getAttribute("data-trade-id"))!;
    expect(await reviewedAt(id)).toBeNull();

    await page.getByRole("radiogroup", { name: "Trade grade" }).getByRole("radio", { name: "B" }).click();
    await page.getByRole("textbox", { name: "Review notes" }).fill("E2E review: entered late.");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.getByTestId("review-save-next").click();

    if (n > 1) {
      await expect(page.getByTestId("review-progress")).toHaveText(`2 of ${n}, 1 reviewed`);
      await expect(page.getByTestId("review-trade")).not.toHaveAttribute("data-trade-id", id);
      // step back with the keyboard: the saved values are there
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("ArrowLeft");
    }
    await expect(page.getByTestId("review-trade")).toHaveAttribute("data-trade-id", id);
    await expect(page.getByTestId("review-saved")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Review notes" })).toHaveValue(
      "E2E review: entered late.",
    );
    await expect(
      page.getByRole("radiogroup", { name: "Trade grade" }).getByRole("radio", { name: "B" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(await reviewedAt(id)).toBeGreaterThan(0);

    // the trade left the queue: reloading shows one fewer
    await page.reload();
    if (n > 1) await expect(page.getByTestId("review-progress")).toHaveText(`1 of ${n - 1}, 0 reviewed`);
    else await expect(page.getByText("Nothing left to review")).toBeVisible();
  });

  test("saving the last trade keeps the flow and shows the done banner; bare /review pins a week", async ({ page }) => {
    await page.goto("/review");
    await expect(page).toHaveURL(/\/review\?.*from=\d{4}-\d{2}-\d{2}.*to=/);
    const n = await openWeekReview(page);
    for (let i = 0; i < n; i++) {
      await page.getByRole("radiogroup", { name: "Trade grade" }).getByRole("radio", { name: "C" }).click();
      await page.getByTestId("review-save-next").click();
      await expect(page.getByTestId("review-progress")).toContainText(`${i + 1} reviewed`);
    }
    await expect(page.getByTestId("review-done")).toHaveText(new RegExp(`All ${n} reviewed`));
    await expect(page.getByTestId("review-saved")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Nothing left to review")).toBeVisible();
  });

  test("the dashboard callout links to the period's review queue", async ({ page }) => {
    await page.goto("/dashboard?period=all");
    const callout = page.getByTestId("reviews-callout");
    await expect(callout).toBeVisible();
    const start = callout.getByTestId("start-review");
    await expect(start).toHaveAttribute("href", /^\/review\?.*period=all/);
    await start.click();
    await expect(page.getByTestId("review-progress")).toHaveText(/^1 of \d+, 0 reviewed$/);
  });
});
