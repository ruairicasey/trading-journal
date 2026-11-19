import { expect, test } from "@playwright/test";

test("cTrader settings: reachable from the nav, inert in the demo, OAuth routes bounce back safely", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("link", { name: "cTrader" }).click();
  await expect(page).toHaveURL(/\/settings\/ctrader$/);
  await expect(page.getByText("view-only").first()).toBeVisible();
  await expect(page.getByText("Disabled for the demo account.")).toBeVisible();
  // no CSV import or connect button on the demo
  await expect(page.getByRole("link", { name: "Connect cTrader" })).toHaveCount(0);
  await expect(page.getByText("Import a cTrader history file")).toHaveCount(0);

  // both OAuth routes refuse on the demo and land back on the page with a message, never at cTrader
  await page.goto("/api/ctrader/connect");
  await expect(page).toHaveURL(/\/settings\/ctrader\?error=demo$/);
  await expect(page.getByRole("status").first()).toContainText("disabled for the demo");
  await page.goto("/api/ctrader/callback?code=x&state=y");
  await expect(page).toHaveURL(/\/settings\/ctrader\?error=demo$/);
});
