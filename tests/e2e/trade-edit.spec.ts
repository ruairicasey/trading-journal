import { expect, test, type Page } from "@playwright/test";

const saved = (page: Page) => expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 10_000 });

async function openClosedSyncedTrade(page: Page, index = 5) {
  await page.goto("/trades?tab=closed");
  const row = page.getByTestId("trade-row").nth(index);
  const id = await row.getAttribute("data-trade-id");
  await page.goto(`/trades/${id}`);
  await page.waitForLoadState("networkidle");
  return id!;
}

test.describe("Edit trade, Basic tab (demo data)", () => {
  test("synced trade: exchange fields are locked, stop loss unlocks R, autosave persists", async ({ page }) => {
    await openClosedSyncedTrade(page);
    await expect(page.getByText(/Synced from Hyperliquid: pair, direction/)).toBeVisible();
    await expect(page.getByLabel("Entry price")).toHaveCount(0); // locked display, not an input
    await expect(page.getByLabel("Pair")).toHaveCount(0);

    const entryText = await page.locator("text=Entry").first().locator("xpath=..").innerText();
    const entry = Number(entryText.replace(/[^\d.]/g, ""));
    const short = await page.getByText("SHORT", { exact: true }).first().isVisible();
    const stop = short ? entry * 1.01 : entry * 0.99;

    // clear any seeded stop first, then set ours
    await page.getByLabel("Stop loss").fill("");
    await page.getByLabel("Stop loss").fill(stop.toFixed(2));
    await expect(page.getByTestId("sl-prompt")).toHaveCount(0);
    await expect(page.getByTestId("realized-r")).toHaveText(/R$/);
    await expect(page.getByText(/Risk \$/)).toBeVisible();
    await saved(page);

    const more = page.getByRole("button", { name: /More details/ });
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click(); // opens by default when it has content
    const box = page.getByRole("checkbox", { name: "Risk calculated" });
    const wasChecked = await box.isChecked();
    await box.click();
    await saved(page);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Stop loss")).toHaveValue(String(Number(stop.toFixed(2))));
    if (!(await page.getByRole("checkbox", { name: "Risk calculated" }).isVisible())) {
      await page.getByRole("button", { name: /More details/ }).click();
    }
    await expect(page.getByRole("checkbox", { name: "Risk calculated" })).toBeChecked({ checked: !wasChecked });
  });

  test("take-profit split must total 100%; ⌘S saves immediately", async ({ page }) => {
    await openClosedSyncedTrade(page, 6);
    const more = page.getByRole("button", { name: /More details/ });
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
    const tp = page.getByTestId("tp-rows");
    await tp.getByRole("button", { name: "Add level" }).click();
    await page.getByLabel("Price 1").fill("100");
    await page.getByLabel("% 1").fill("60");
    await expect(page.getByText(/they must add up to 100%/)).toBeVisible();
    await expect(page.getByTestId("save-status")).toContainText(/must add up to 100%/, { timeout: 10_000 });

    await tp.getByRole("button", { name: "Add level" }).click();
    await page.getByLabel("Price 2").fill("110");
    await page.getByLabel("% 2").fill("40");
    await expect(page.getByText("Allocations total 100% ✓")).toBeVisible();
    await page.keyboard.press("Control+s");
    await saved(page);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByLabel("Price 2")).toHaveValue("110");
    // clean up so the test is repeatable
    await page.getByRole("button", { name: "Remove row 2" }).click();
    await page.getByRole("button", { name: "Remove row 1" }).click();
    await page.keyboard.press("Control+s");
    await saved(page);
  });

  test("manual planned trade: edit everything, close it, metrics are computed", async ({ page }) => {
    await page.goto("/trades");
    await page.getByTestId("trade-row").first().getByRole("button", { name: "Trade actions" }).click();
    await page.getByRole("menuitem", { name: "Duplicate as planned" }).click();
    await expect(page.getByText(/Planned copy of/)).toBeVisible();
    await page.goto("/trades?tab=planned");
    const id = await page.getByTestId("trade-row").first().getAttribute("data-trade-id");
    await page.goto(`/trades/${id}`);
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("Manual trade: every field is editable.")).toBeVisible();
    await page.getByLabel("Pair").fill("SOL");
    await page.getByRole("radio", { name: "Long" }).click();
    await page.getByRole("radio", { name: "Closed" }).click();
    await page.getByLabel("Entry price").fill("100");
    await page.getByLabel("Exit price").fill("110");
    await page.getByLabel("Size in units").fill("5");
    await expect(page.getByLabel("Size in USD")).toHaveValue("500");
    await page.getByLabel("Stop loss").fill("95");
    await expect(page.getByTestId("realized-r")).toHaveText("+2.00R");
    await page.getByRole("button", { name: /More details/ }).click();
    await page.getByLabel("Entry time").fill("2026-11-02T10:00");
    await page.getByLabel("Exit time").fill("2026-11-02T14:30");
    await saved(page);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "SOL/USD" })).toBeVisible();
    await expect(page.getByText("closed", { exact: true })).toBeVisible();
    await expect(page.getByText("+$50.00").first()).toBeVisible(); // header and result
  });
});
