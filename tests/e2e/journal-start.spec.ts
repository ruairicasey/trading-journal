import { expect, test, type Page } from "@playwright/test";

const count = async (page: Page, tab: string) =>
  Number(
    await page
      .getByRole("navigation", { name: "Trade tabs" })
      .getByRole("link", { name: new RegExp(`^${tab}`) })
      .locator("span")
      .innerText(),
  );
const closedInReport = async (page: Page) =>
  Number(
    (await page.getByText(/\d+ closed trades? by exit time/).innerText()).match(/(\d+) closed trade/)![1],
  );

async function setStart(page: Page, date: string) {
  await page.goto("/settings/accounts");
  const form = page.locator("form").first();
  await form.locator('input[name="journalStartDate"]').fill(date);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByText("Saved")).toBeVisible();
}

test("journal start: views hide older trades, All time shows them, and before + after = all", async ({
  page,
}) => {
  // a date inside the demo history: 45 days ago
  const d = new Date(Date.now() - 45 * 86_400_000);
  const date = d.toISOString().slice(0, 10);
  const dayBefore = new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10);
  await setStart(page, date);
  try {
    await page.goto("/trades?tab=closed");
    await expect(page.getByTestId("journal-start-note")).toBeVisible();
    const after = await count(page, "Closed");
    await page.getByRole("link", { name: "Show all time" }).click();
    await expect(page).toHaveURL(/period=all/);
    const all = await count(page, "Closed");
    // opened up to the day before the start (All time + a date range)
    await page.goto(`/trades?tab=closed&period=all&to=${dayBefore}`);
    const before = await count(page, "Closed");
    expect(after).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
    expect(before + after).toBe(all);

    // Analytics now defaults to "Since start"; Reports "Since start" has the same trades as the list
    await page.goto("/analytics");
    await expect(
      page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "Since start" }),
    ).toHaveAttribute("aria-current", "true");
    await page.goto("/reports?period=start");
    expect(await closedInReport(page)).toBe(after);
    await page.goto("/reports?period=all");
    expect(await closedInReport(page)).toBe(all);
  } finally {
    await setStart(page, "");
  }
  await page.goto("/trades?tab=closed");
  await expect(page.getByTestId("journal-start-note")).toHaveCount(0);
});
