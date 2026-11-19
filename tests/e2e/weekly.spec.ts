import { expect, test } from "@playwright/test";

/** Demo data spans ~6 months ending now; walk back to a week with closed trades and journal gaps. */
async function weekWithGaps(page: import("@playwright/test").Page) {
  for (let i = 0; i < 12; i++) {
    const day = new Date(Date.now() - i * 7 * 86_400_000).toISOString().slice(0, 10);
    await page.goto(`/dashboard?week=${day}`);
    await expect(page.getByTestId("weekly-card")).toBeVisible();
    if ((await page.getByTestId("missing-context").getByRole("link").count()) > 0) return;
  }
  throw new Error("no week with missing context in the demo data");
}

test.describe("Weekly reflection and drawdown (demo data)", () => {
  test("drawdown card (Analytics → Risk) shows current and max drawdown with an underwater chart", async ({
    page,
  }) => {
    await page.goto("/analytics?section=risk&period=all");
    const card = page.getByTestId("drawdown-card");
    await expect(card.getByTestId("dd-current")).toContainText("Current");
    await expect(card.getByTestId("dd-max")).toContainText("peak");
    await expect(card.locator(".recharts-area-curve")).toBeVisible();
    await page.goto("/analytics?section=risk&period=all&unit=r");
    await expect(page.getByTestId("dd-max")).toContainText("R");
  });

  test("each missing-context count opens exactly that many trades", async ({ page }) => {
    await weekWithGaps(page);
    const links = page.getByTestId("missing-context").getByRole("link");
    const n = await links.count();
    for (let i = 0; i < n; i++) {
      const link = links.nth(i);
      const text = await link.innerText();
      const count = Number(/(\d+)\s*$/.exec(text)?.[1] ?? /Review the (\d+)/.exec(text)?.[1]);
      const href = (await link.getAttribute("href"))!;
      const back = page.url();
      await page.goto(href);
      await expect(page.getByTestId("trade-row")).toHaveCount(Math.min(count, 20));
      await page.goto(back);
    }
  });

  test("week navigation and the weekly note (create, then reopen)", async ({ page }) => {
    await weekWithGaps(page);
    const range = await page.getByTestId("weekly-range").innerText();
    await page.getByTestId("weekly-note").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox", { name: "Note", exact: true })).toHaveValue(/What went well\?/);
    await dialog
      .getByRole("textbox", { name: "Note", exact: true })
      .fill("E2E weekly note: cut size after two losses.");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("weekly-range")).toHaveText(range);
    await expect(page.getByTestId("weekly-note")).toHaveText(/Open weekly note/);
    await page.getByTestId("weekly-note").click();
    await expect(page.getByRole("dialog").getByRole("textbox", { name: "Note", exact: true })).toHaveValue(
      "E2E weekly note: cut size after two losses.",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Previous week" }).click();
    await expect(page.getByTestId("weekly-range")).not.toHaveText(range);
  });
});
