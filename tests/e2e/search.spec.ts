import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { DEMO_DB_FILE } from "../../scripts/demo-env";

async function query<T>(sql: string): Promise<T[]> {
  const db = createClient({ url: `file:${DEMO_DB_FILE}` });
  const r = await db.execute(sql);
  db.close();
  return r.rows as unknown as T[];
}

test("full-text search: words from different places in the notes find the trade, with the hit highlighted", async ({
  page,
}) => {
  const [t] = await query<{ id: string; rationale: string }>(
    `select t.id, j.rationale from trades t join trade_journal j on j.trade_id = t.id
     where t.deleted_at is null and coalesce(json_extract(t.flags, '$.superseded'), 0) = 0
       and length(j.rationale) > 40 order by t.entry_time desc limit 1`,
  );
  const words = t.rationale.split(/\W+/).filter((w) => w.length >= 5);
  const q = `${words[words.length - 1]} ${words[0]}`; // out of order: still a match
  await page.goto(`/trades?q=${encodeURIComponent(q)}`);
  const row = page.locator(`[data-trade-id="${t.id}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("trade-match").locator("mark").first()).toBeVisible();
  // at least every trade whose notes alone hold both words is listed (other fields can add more)
  const [w1, w2] = [words[words.length - 1], words[0]].map((w) => w.toLowerCase().replace(/'/g, "''"));
  const [{ n }] = await query<{ n: number }>(
    `select count(*) as n from trades t join trade_journal j on j.trade_id = t.id
     where t.deleted_at is null and coalesce(json_extract(t.flags, '$.superseded'), 0) = 0
       and lower(j.rationale) like '%${w1}%' and lower(j.rationale) like '%${w2}%'`,
  );
  const all = Number(
    await page
      .getByRole("navigation", { name: "Trade tabs" })
      .getByRole("link", { name: /^All/ })
      .locator("span")
      .innerText(),
  );
  expect(all).toBeGreaterThanOrEqual(Number(n));
  // most rows show where they hit (a hit only in a linked label, e.g. a confluence, has no text snippet)
  expect(await page.getByTestId("trade-row").getByTestId("trade-match").count()).toBeGreaterThan(0);

  // a word that appears nowhere rules everything out
  await page.goto(`/trades?q=${encodeURIComponent(`${q} zzqqxx`)}`);
  await expect(page.getByText("No trades match")).toBeVisible();
});
