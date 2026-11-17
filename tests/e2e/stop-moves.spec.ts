import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { DEMO_DB_FILE } from "../../scripts/demo-env";

async function query<T>(sql: string): Promise<T[]> {
  const db = createClient({ url: `file:${DEMO_DB_FILE}` });
  const r = await db.execute(sql);
  db.close();
  return r.rows as unknown as T[];
}

const WITH_STOP = `from trades t join trade_journal j on j.trade_id = t.id
  where t.status = 'closed' and t.deleted_at is null and coalesce(json_extract(t.flags, '$.superseded'), 0) = 0
    and t.exit_time is not null and t.net_pnl is not null and j.stop_loss is not null and t.avg_entry is not null`;

test("add, validate, edit and delete your own stop move; each move is classed", async ({ page }) => {
  // a closed demo trade with a stop and no stop moves at all
  const [t] = await query<{ id: string; direction: string; entry: number; sl: number }>(
    `select t.id, t.direction, t.avg_entry as entry, j.stop_loss as sl ${WITH_STOP}
       and not exists (select 1 from stop_moves m where m.trade_id = t.id) order by t.entry_time desc limit 1`,
  );
  const sign = t.direction === "long" ? 1 : -1;
  const risk = Math.abs(t.entry - t.sl);
  const widen = (t.sl - sign * risk * 0.5).toPrecision(8);
  const tighten = (t.sl + sign * risk * 0.5).toPrecision(8);

  await page.goto(`/trades/${t.id}`);
  await page.waitForLoadState("networkidle");
  const box = page.getByTestId("stop-moves");
  await expect(box.getByTestId("stop-move-row")).toHaveCount(0);

  // no price: refused with a message
  await box.getByRole("button", { name: "Add stop move" }).click();
  await box.getByRole("button", { name: "Save move" }).click();
  await expect(box.getByRole("alert")).toHaveText("Enter a time and a price above 0");

  // a wider stop (time defaults to the entry minute)
  await box.getByLabel("Stop price").fill(widen);
  await box.getByLabel("Note").fill("e2e: gave it room");
  await box.getByRole("button", { name: "Save move" }).click();
  const row = box.getByTestId("stop-move-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("added by you");
  await expect(row).toContainText("e2e: gave it room");
  await expect(row.getByTestId("stop-move-kind")).toHaveText("widened");
  await expect(row).toContainText("locks -1.50R");
  await expect(box.getByTestId("stop-class")).toHaveText("stop widened");

  // it is stored: survives a reload
  await page.reload();
  await expect(box.getByTestId("stop-move-row")).toHaveCount(1);

  // edit it into a tighter stop
  await box.getByRole("button", { name: "Edit stop move" }).click();
  await box.getByLabel("Stop price").fill(tighten);
  await box.getByRole("button", { name: "Save move" }).click();
  await expect(box.getByTestId("stop-move-kind")).toHaveText("tightened");
  await expect(box.getByTestId("stop-move-row")).toContainText("locks -0.50R");

  // delete: asks inline first, "Keep" backs out, "Delete" removes it
  await box.getByRole("button", { name: "Delete stop move" }).click();
  await box.getByRole("button", { name: "Keep" }).click();
  await expect(box.getByTestId("stop-move-row")).toHaveCount(1);
  await box.getByRole("button", { name: "Delete stop move" }).click();
  await box.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(box.getByTestId("stop-move-row")).toHaveCount(0);
  expect(await query(`select 1 from stop_moves where trade_id = '${t.id}'`)).toHaveLength(0);
});

test("exchange stop moves are shown classed and can't be edited", async ({ page }) => {
  const [t] = await query<{ id: string }>(`select distinct trade_id as id from stop_moves where source = 'auto' limit 1`);
  await page.goto(`/trades/${t.id}`);
  const rows = page.getByTestId("stop-move-row");
  await expect(rows.first()).toContainText("from your exchange orders");
  await expect(rows.first().getByTestId("stop-move-kind")).toHaveText(/tightened|widened|to breakeven|trailing in profit|re-placed/);
  await expect(page.getByRole("button", { name: "Edit stop move" })).toHaveCount(0);
});

test("Stop management widget: every trade with a stop in exactly one class; counts and net reconcile", async ({ page }) => {
  await page.goto("/analytics?section=behaviour&period=all");
  const w = page.getByTestId("widget-stop-management");
  await expect(w).toBeVisible();
  const titles = await w.locator("li[title]").evaluateAll((els) => els.map((e) => e.getAttribute("title") ?? ""));
  const rows = titles.map((s) => ({
    label: s.split(":")[0],
    n: Number(/: (\d+) trades?/.exec(s)![1]),
    net: Number(/net ([+-−]?)\$([\d,.]+)/.exec(s)!.slice(1).join("").replace("−", "-").replace(/,/g, "")),
  }));
  // the seeded moves of your own make sure these classes exist
  expect(rows.map((r) => r.label)).toEqual(expect.arrayContaining(["Stop widened", "Moved to breakeven", "Trailed into profit", "Never moved"]));

  const [expected] = await query<{ n: number; net: number }>(`select count(*) as n, sum(t.net_pnl) as net ${WITH_STOP}`);
  expect(rows.reduce((a, r) => a + r.n, 0)).toBe(Number(expected.n));
  // each bucket's net is shown rounded to the cent: allow half a cent per bucket
  expect(Math.abs(rows.reduce((a, r) => a + r.net, 0) - Number(expected.net))).toBeLessThanOrEqual(0.005 * rows.length + 1e-9);

  // $ values in the widget blur in privacy mode
  await page.getByRole("button", { name: "Hide amounts" }).click();
  await expect(w.locator(".money").first()).toHaveCSS("filter", /blur/);
  await page.getByRole("button", { name: "Show amounts" }).click();
});
