import { expect, test } from "@playwright/test";

test("add a Lighter account: asks for a read-only token, refuses anything else, and fits a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/settings/wallets");
  await expect(page.getByTestId("wallet-exchange").first()).toHaveText("Hyperliquid");
  await page.getByRole("button", { name: "Add wallet" }).click();
  await page.getByRole("combobox", { name: "Exchange" }).click();
  await page.getByRole("option", { name: "Lighter" }).click();
  await expect(page.getByPlaceholder("0x…")).toHaveCount(0);
  const token = page.getByLabel("Read-only token");
  await expect(token).toHaveAttribute("type", "password");
  const add = page.getByRole("button", { name: "Add Lighter account" });
  await token.fill("not-a-token");
  await expect(page.getByText("Must start with ro:")).toBeVisible();
  await expect(add).toBeDisabled();
  await token.fill(`ro:4242:single:1893456000:${"ab".repeat(8)}`);
  await add.click();
  await expect(page.getByText("Not available for the demo account.")).toBeVisible();
  await expect(token).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
