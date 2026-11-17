import { expect, test, type Page } from "@playwright/test";

async function setIncludeFunding(page: Page, on: boolean) {
  await page.goto("/settings");
  const box = page.getByLabel("Include funding in net P&L");
  if ((await box.isChecked()) !== on) await box.click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved")).toBeVisible();
}

test("funding shows on the dashboard and the trade; the setting moves it in and out of net P&L", async ({ page }) => {
  await page.goto("/dashboard?period=all");
  await expect(page.getByTestId("kpi-funding")).toHaveText(/[+-]\$/);
  await expect(page.getByTestId("kpi-fees")).toContainText("funding in net");
  const withFunding = await page.getByTestId("kpi-net").locator("div").nth(1).innerText();

  await setIncludeFunding(page, false);
  await page.goto("/dashboard?period=all");
  await expect(page.getByTestId("kpi-fees")).toContainText("funding not in net");
  const without = await page.getByTestId("kpi-net").locator("div").nth(1).innerText();
  expect(without).not.toBe(withFunding);

  await setIncludeFunding(page, true);
  await page.goto("/dashboard?period=all");
  await expect(page.getByTestId("kpi-net").locator("div").nth(1)).toHaveText(withFunding);

  // a synced trade shows its funding (locked)
  await page.goto("/trades?tab=closed");
  await page.getByTestId("trade-row").first().getByTestId("trade-expand").click();
  await expect(page.getByTestId("trade-row").first().getByTestId("trade-details")).toContainText("Funding");
});
