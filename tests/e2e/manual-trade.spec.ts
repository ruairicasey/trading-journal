import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { DEMO_DB_FILE } from "../../scripts/demo-env";

// the trades made here are removed afterwards so later specs see the demo data as seeded
const created: string[] = [];
test.afterAll(async () => {
  const db = createClient({ url: `file:${DEMO_DB_FILE}` });
  for (const id of created) {
    await db.execute({ sql: "delete from trade_journal where trade_id = ?", args: [id] });
    await db.execute({ sql: "delete from trades where id = ?", args: [id] });
  }
  db.close();
});
const remember = (url: string) => created.push(url.split("/").pop()!);

test.describe("Manual trade entry (demo data)", () => {
  test("Add trade creates a closed manual trade and opens its edit page", async ({ page }) => {
    await page.goto("/trades");
    await page.getByTestId("add-trade").click();
    await expect(page).toHaveURL(/\/trades\/new$/);

    await page.getByRole("textbox", { name: "Pair" }).fill("sol");
    await page.getByRole("radiogroup", { name: "Direction" }).getByRole("radio", { name: "Short" }).click();
    await page.getByRole("textbox", { name: "Entry price" }).fill("200");
    await page.getByRole("textbox", { name: "Exit price" }).fill("190");
    await page.getByRole("textbox", { name: "Size" }).fill("10");
    await page.getByRole("textbox", { name: "Fees" }).fill("2");
    await expect(page.getByTestId("manual-net")).toHaveText("+$98.00");

    // validation: closed trades need their times
    await page.getByTestId("manual-create").click();
    await expect(page.getByText("Enter when you opened it")).toBeVisible();

    await page.getByLabel("Entry time").fill("2026-11-10T09:00");
    await page.getByLabel("Exit time").fill("2026-11-10T13:30");
    await page.getByTestId("manual-create").click();

    await expect(page).toHaveURL(/\/trades\/(?!new)[\w-]+$/);
    remember(page.url()); // straight away, so a failing assertion below still cleans up
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("SOL/USD");
    await expect(page.getByTestId("trade-status")).toHaveText("Closed");
    await expect(page.getByText("Manual", { exact: true })).toBeVisible();
    await expect(page.getByText("+$98.00").first()).toBeVisible();

    // and it is listed under Closed
    await page.goto("/trades?tab=closed&period=all&pair=SOL");
    await expect(page.getByTestId("trade-row").filter({ hasText: "+$98.00" })).toHaveCount(1);
  });

  test("a planned trade needs no prices filled in beyond the pair", async ({ page }) => {
    await page.goto("/trades/new");
    await page.getByRole("textbox", { name: "Pair" }).fill("BTC");
    await page.getByRole("radiogroup", { name: "Status" }).getByRole("radio", { name: "Planned" }).click();
    await expect(page.getByLabel("Exit time")).toBeDisabled();
    await page.getByTestId("manual-create").click();
    await expect(page).toHaveURL(/\/trades\/(?!new)[\w-]+$/);
    remember(page.url());
    await expect(page.getByTestId("trade-status")).toHaveText("Planned");
  });
});
