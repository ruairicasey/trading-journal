import { createClient } from "@libsql/client";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_DB_FILE } from "../../scripts/demo-env";

async function query<T>(sql: string, args: (string | number | null)[] = []): Promise<T[]> {
  const db = createClient({ url: `file:${DEMO_DB_FILE}` });
  const r = await db.execute({ sql, args });
  db.close();
  return r.rows as unknown as T[];
}
const tabCount = async (page: Page, tab: string) =>
  Number(
    await page
      .getByRole("navigation", { name: "Trade tabs" })
      .getByRole("link", { name: new RegExp(`^${tab}`) })
      .locator("span")
      .innerText(),
  );
const TAG = "e2e-bulk";
/** wait for hydration before clicking client-side controls */
const open = async (page: Page, url: string) => {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
};

test("bulk: select all matching, add a tag, set a grade, delete and undo", async ({ page }) => {
  await open(page, "/trades?tab=closed&dir=short");
  const matching = await tabCount(page, "Closed");
  expect(matching).toBeGreaterThan(20); // more than one page
  await page.getByLabel("Select all trades on this page").click();
  await expect(page.getByTestId("bulk-count")).toHaveText("20 selected");
  await page.getByRole("button", { name: `Select all ${matching} matching` }).click();
  await expect(page.getByTestId("bulk-count")).toHaveText(`${matching} selected`);
  await page.getByRole("button", { name: "Clear selection" }).click();
  await expect(page.getByTestId("bulk-bar")).toHaveCount(0);

  // three trades from the list
  const rows = page.getByTestId("trade-row");
  const ids = await Promise.all([0, 1, 2].map((i) => rows.nth(i).getAttribute("data-trade-id")));
  const before = await query<{ id: string; grade: string | null; j: number }>(
    `select t.id, j.grade, (j.trade_id is not null) as j from trades t left join trade_journal j on j.trade_id = t.id where t.id in (?, ?, ?)`,
    ids,
  );
  try {
    for (let i = 0; i < 3; i++) await rows.nth(i).getByTestId("trade-select").click();
    await expect(page.getByTestId("bulk-count")).toHaveText("3 selected");

    await page.getByRole("button", { name: "Add tag" }).click();
    await page.getByRole("dialog").getByLabel("Tag").fill(TAG);
    await page.getByRole("dialog").getByRole("button", { name: "Add tag" }).click();
    await expect(page.getByText(`#${TAG} added to 3 trades`)).toBeVisible();
    // every action clears the selection (it may change which trades match)
    await expect(page.getByTestId("bulk-bar")).toHaveCount(0);
    for (let i = 0; i < 3; i++) await rows.nth(i).getByTestId("trade-select").click();
    await expect(page.getByTestId("bulk-count")).toHaveText("3 selected");

    await page.getByRole("button", { name: "More bulk actions" }).click();
    await page.getByRole("menuitem", { name: "Grade" }).click();
    await page.getByRole("menuitem", { name: "D", exact: true }).click();
    await expect(page.getByText("Grade D set on 3 trades")).toBeVisible();
    const after = await query<{ grade: string; tags: string }>(
      `select j.grade, (select group_concat(g.name) from trade_tags tt join tags g on g.id = tt.tag_id where tt.trade_id = j.trade_id) as tags
       from trade_journal j where j.trade_id in (?, ?, ?)`,
      ids,
    );
    expect(after.map((a) => a.grade)).toEqual(["D", "D", "D"]);
    expect(after.every((a) => a.tags.split(",").includes(TAG))).toBe(true);

    // the tag is searchable: exactly these three
    await page.goto(`/trades?q=${TAG}`);
    await expect(page.getByTestId("trade-row")).toHaveCount(3);
    const all = await tabCount(page, "All");
    expect(all).toBe(3);

    // delete all three, then undo
    await page.goto("/trades");
    const total = await tabCount(page, "All");
    await open(page, `/trades?q=${TAG}`);
    await page.getByLabel("Select all trades on this page").click();
    await page.getByRole("button", { name: "More bulk actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete 3 trades" }).click();
    await expect(page.getByText("3 trades deleted")).toBeVisible();
    await expect(page.getByTestId("bulk-bar")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await query<{ n: number }>(
              `select count(*) as n from trades where id in (?, ?, ?) and deleted_at is not null`,
              ids,
            )
          )[0].n,
      )
      .toBe(3);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("3 trades restored")).toBeVisible();
    await expect
      .poll(
        async () =>
          (
            await query<{ n: number }>(
              `select count(*) as n from trades where id in (?, ?, ?) and deleted_at is null`,
              ids,
            )
          )[0].n,
      )
      .toBe(3);
    await page.goto("/trades");
    expect(await tabCount(page, "All")).toBe(total);
  } finally {
    await query(`update trades set deleted_at = null where id in (?, ?, ?)`, ids);
    for (const b of before) {
      if (Number(b.j)) await query("update trade_journal set grade = ? where trade_id = ?", [b.grade, b.id]);
      else await query("delete from trade_journal where trade_id = ?", [b.id]);
    }
    await query(`delete from trade_tags where tag_id in (select id from tags where name = ?)`, [TAG]);
    await query(`delete from tags where name = ?`, [TAG]);
  }
});

test("saved filters: save the current filters, apply from the chip, remove", async ({ page }) => {
  try {
    await open(page, "/trades?dir=long&outcome=loss");
    const losses = await tabCount(page, "All");
    await page.getByRole("button", { name: "Save filter" }).click();
    await page.getByRole("dialog").getByLabel("Filter name").fill("E2E long losers");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    const chip = page.getByTestId("saved-filter").filter({ hasText: "E2E long losers" });
    await expect(chip.getByRole("link")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Save filter" })).toHaveCount(0); // already saved

    await open(page, "/trades");
    await expect(chip.getByRole("link")).toHaveAttribute("aria-pressed", "false");
    await chip.getByRole("link").click();
    await expect(page).toHaveURL(/dir=long/);
    await expect(page).toHaveURL(/outcome=loss/);
    expect(await tabCount(page, "All")).toBe(losses);
    await expect(chip.getByRole("link")).toHaveAttribute("aria-pressed", "true");

    await chip.getByRole("button", { name: "Remove saved filter E2E long losers" }).click();
    await expect(chip).toHaveCount(0);
    expect(await query("select id from saved_filters where name = 'E2E long losers'")).toEqual([]);
  } finally {
    await query("delete from saved_filters where name = 'E2E long losers'");
  }
});

test("TradingView: a snapshot link becomes a screenshot with its source link", async ({ page }) => {
  const [t] = await query<{ id: string }>(
    "select id from trades where status = 'closed' and deleted_at is null order by entry_time desc limit 1 offset 5",
  );
  const link = "https://www.tradingview.com/x/E2eTest1/";
  try {
    await open(page, `/trades/${t.id}`);
    await page.getByRole("tab", { name: /Notes/ }).click();
    const shots = page.getByTestId("screenshot");
    const before = await shots.count();
    const form = page.getByTestId("tradingview-import");
    await form.getByLabel("TradingView snapshot link").fill("https://example.com/x/E2eTest1/");
    await form.getByRole("button", { name: "Import" }).click();
    await expect(
      page.getByText("That isn't a TradingView snapshot link", { exact: false }).first(),
    ).toBeVisible();
    await expect(shots).toHaveCount(before);

    await form.getByLabel("TradingView snapshot link").fill(link);
    await form.getByRole("button", { name: "Import" }).click();
    await expect(shots).toHaveCount(before + 1, { timeout: 30_000 });
    await expect(form.getByLabel("TradingView snapshot link")).toHaveValue("");
    const [row] = await query<{ source_url: string; caption: string }>(
      "select source_url, caption from screenshots where trade_id = ? order by sort desc limit 1",
      [t.id],
    );
    expect(row).toEqual({ source_url: link, caption: "TradingView" });
    const src = await shots.last().locator("img").getAttribute("src");
    expect((await page.request.get(src!)).status()).toBe(200);
  } finally {
    await query("delete from screenshots where trade_id = ? and source_url = ?", [t.id, link]);
  }
});
