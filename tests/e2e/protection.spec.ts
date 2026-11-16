import { createClient } from "@libsql/client";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_DB_FILE } from "../../scripts/demo-env";

const saved = (page: Page) => expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 10_000 });

/** A demo trade whose stop loss was auto-detected from (synthetic) stop orders and moved at least once. */
async function autoTradeWithMoves() {
  const db = createClient({ url: `file:${DEMO_DB_FILE}` });
  const r = await db.execute(
    `select j.trade_id as id, j.stop_loss as sl from trade_journal j join trades t on t.id = j.trade_id
     where j.stop_loss_source = 'auto' and t.deleted_at is null
       and exists (select 1 from stop_moves m where m.trade_id = j.trade_id and m.source = 'auto')
     order by t.entry_time desc limit 1`,
  );
  db.close();
  return { id: String(r.rows[0].id), sl: Number(r.rows[0].sl) };
}

test("auto-detected stop loss: hint, stop moves, user edit wins, revert to auto", async ({ page }) => {
  const { id, sl } = await autoTradeWithMoves();
  await page.goto(`/trades/${id}`);
  await page.waitForLoadState("networkidle");

  const input = page.getByLabel("Stop loss");
  await expect(input).toHaveValue(String(sl));
  await expect(page.getByTestId("stopLoss-auto")).toContainText("Auto from your stop order");
  await expect(page.getByTestId("stop-moves")).toContainText("initial");

  // typing a different stop makes it the user's value
  await input.fill(String(Number((sl * 0.97).toPrecision(6))));
  await saved(page);
  await expect(page.getByTestId("stopLoss-auto")).toContainText("Your stop order was");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("stopLoss-auto")).toContainText("Revert to auto");

  // revert puts the exchange value back and hands the field back to sync
  await page.getByRole("button", { name: "Revert to auto" }).click();
  await expect(input).toHaveValue(String(sl));
  await expect(page.getByTestId("stopLoss-auto")).toContainText("Auto from your stop order");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Stop loss")).toHaveValue(String(sl));
  await expect(page.getByTestId("stopLoss-auto")).toContainText("Auto from your stop order");
});
