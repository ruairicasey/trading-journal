import { expect, test } from "@playwright/test";

// Demo data: sync is disabled, so the status reads "Demo: sync disabled". What matters here is that the status is
// rendered exactly once, in the right place for the screen size (the auto-sync loop lives in one provider).
const status = (page: import("@playwright/test").Page) =>
  page.getByText("Demo: sync disabled", { exact: true });

test.describe("app shell", () => {
  test("desktop: sync status once, in the sidebar; the current page is marked", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/dashboard");
    await expect(status(page)).toHaveCount(1);
    await expect(page.locator('[data-slot="sidebar"]').getByText("Demo: sync disabled")).toBeVisible();
    await expect(
      page.locator('[data-slot="sidebar-inset"] > header').getByText("Demo: sync disabled"),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-slot="sidebar"]').getByRole("link", { name: "Dashboard", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.locator('[data-slot="sidebar"]').getByRole("link", { name: "Trades", exact: true }),
    ).not.toHaveAttribute("aria-current", "page");

    // collapsing the sidebar never leaves two status views mounted
    await page.keyboard.press("ControlOrMeta+b");
    await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toHaveCount(1);
    await expect(status(page)).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+b");
    await expect(status(page)).toHaveCount(1);
  });

  test("phone: sync status once, in the top bar, also with the sidebar sheet open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");
    await expect(
      page.locator('[data-slot="sidebar-inset"] > header').getByText("Demo: sync disabled"),
    ).toBeVisible();
    await expect(status(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: "Trades", exact: true })).toBeVisible();
    await expect(status(page)).toHaveCount(1);
  });
});
