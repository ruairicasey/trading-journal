import { expect, test, type Page } from "@playwright/test";

const count = async (page: Page, tab: string) =>
  Number(await page.getByRole("navigation", { name: "Trade tabs" }).getByRole("link", { name: new RegExp(`^${tab}`) }).locator("span").innerText());

test.describe("Trades page (demo data)", () => {
  test("tabs with counts, rows expand to details", async ({ page }) => {
    await page.goto("/trades");
    const all = await count(page, "All");
    expect(all).toBeGreaterThan(100);
    expect(all).toBe((await count(page, "Planned")) + (await count(page, "Open")) + (await count(page, "Closed")));
    await expect(page.getByTestId("trade-row")).toHaveCount(20);
    await page.getByTestId("trade-row").first().getByTestId("trade-expand").click();
    const details = page.getByTestId("trade-details").first();
    await expect(details).toContainText("Entry → exit");
    await expect(details).toContainText("hyperliquid auto-sync");
    await expect(details.getByRole("link", { name: "Edit trade →" })).toBeVisible();
    await page.getByRole("link", { name: /^Open \d+/ }).click();
    await expect(page).toHaveURL(/tab=open/);
    await expect(page.getByTestId("trade-row").first()).toContainText("Open");
  });

  test("filters panel narrows the list and pills clear it", async ({ page }) => {
    await page.goto("/trades");
    await page.getByRole("button", { name: /Filters/ }).click();
    const sheet = page.getByRole("dialog");
    await sheet.locator("div.grid", { hasText: /^Direction/ }).getByRole("combobox").click();
    await page.getByRole("option", { name: "Long", exact: true }).click();
    await sheet.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/dir=long/);
    const rows = page.getByTestId("trade-row");
    await expect(rows.first()).toBeVisible();
    for (const text of await rows.allInnerTexts()) {
      expect(text).toMatch(/\blong\b/i);
      expect(text).not.toMatch(/\bshort\b/i);
    }
    await page.getByRole("link", { name: /Longs/ }).click();
    await expect(page).not.toHaveURL(/dir=long/);
  });

  test("quick chip toggles losing trades", async ({ page }) => {
    await page.goto("/trades");
    await page.getByRole("link", { name: "Losing trades" }).click();
    await expect(page).toHaveURL(/outcome=loss/);
    await expect(page.getByRole("link", { name: "Losing trades" })).toHaveAttribute("aria-pressed", "true");
    const nets = await page.getByTestId("trade-row").locator(".text-loss").first().innerText();
    expect(nets.startsWith("-")).toBe(true);
    await expect(page.getByTestId("trade-row").locator(".text-profit")).toHaveCount(0);
    await page.getByRole("link", { name: "Losing trades" }).click();
    await expect(page).not.toHaveURL(/outcome=loss/);
  });

  test("⌘K search jumps to matching trades", async ({ page }) => {
    await page.goto("/trades");
    await page.waitForLoadState("networkidle"); // shortcut listener is attached after hydration
    await expect(async () => {
      await page.keyboard.press("Control+k");
      await expect(page.getByPlaceholder("Search trades, tags, notes…")).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.getByPlaceholder("Search trades, tags, notes…").fill("SPX");
    await page.getByRole("option", { name: /Search trades for “SPX”/ }).click();
    await expect(page).toHaveURL(/q=SPX/);
    const texts = await page.getByTestId("trade-row").allInnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toContain("SPX");
  });

  test("delete asks for confirmation and can be undone", async ({ page }) => {
    await page.goto("/trades?tab=closed");
    const before = await count(page, "Closed");
    const first = page.getByTestId("trade-row").first();
    const id = await first.getAttribute("data-trade-id");
    await first.getByRole("button", { name: "Trade actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(`[data-trade-id="${id}"]`)).toHaveCount(0);
    expect(await count(page, "Closed")).toBe(before - 1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator(`[data-trade-id="${id}"]`)).toHaveCount(1);
    expect(await count(page, "Closed")).toBe(before);
  });

  test("duplicate creates a planned trade; notes can be added and searched", async ({ page }) => {
    await page.goto("/trades");
    const planned = await count(page, "Planned");
    await page.getByTestId("trade-row").first().getByRole("button", { name: "Trade actions" }).click();
    await page.getByRole("menuitem", { name: "Duplicate as planned" }).click();
    await expect(page.getByText(/Planned copy of/)).toBeVisible();
    await expect.poll(() => count(page, "Planned")).toBe(planned + 1);

    await page.goto("/trades?tab=notes");
    await page.getByRole("button", { name: "Add note" }).click();
    await page.getByPlaceholder(/Weekly review/).fill("Weekly review");
    await page.getByRole("dialog").locator("textarea").fill("Cut reactive Asia entries next week.");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("notes-list")).toContainText("Weekly review");
    await page.getByLabel("Search trades").fill("reactive asia");
    await page.getByLabel("Search trades").press("Enter");
    await expect(page.getByTestId("notes-list")).toContainText("Cut reactive Asia entries");
  });

  test("edit page opens from the row menu and lists the exchange fills", async ({ page }) => {
    await page.goto("/trades?tab=closed");
    await page.getByTestId("trade-row").first().getByRole("button", { name: "Trade actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/trades\/[\w-]+$/);
    await expect(page.getByText("Synced from Hyperliquid", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Exchange fills \(\d+\)/ })).toBeVisible();
  });
});
