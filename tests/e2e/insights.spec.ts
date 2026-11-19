import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { DEMO_DB_FILE } from "../../scripts/demo-env";

async function query<T>(sql: string): Promise<T[]> {
  const db = createClient({ url: `file:${DEMO_DB_FILE}` });
  const r = await db.execute(sql);
  db.close();
  return r.rows as unknown as T[];
}
const LIVE =
  "t.deleted_at is null and coalesce(json_extract(t.flags, '$.superseded'), 0) = 0 and t.status = 'closed' and t.exit_time is not null and t.net_pnl is not null";
const money = (s: string) => Math.round(Number(s.replace(/[^0-9.-]/g, "")) * 100);

test("Insights: losing patterns ranked worst first, counts match the journal, dashboard shows the top 3", async ({
  page,
}) => {
  await page.goto("/analytics?section=insights&period=all");
  const cards = page.getByTestId("insight");
  await expect(cards.first()).toBeVisible();
  const n = await cards.count();
  expect(n).toBeGreaterThanOrEqual(3);

  const impacts: number[] = [];
  const byId: Record<string, { n: number; impact: number }> = {};
  for (let i = 0; i < n; i++) {
    const c = cards.nth(i);
    const id = (await c.getAttribute("data-insight"))!;
    const impact = money(await c.getByTestId("insight-impact").innerText());
    const count = Number((await c.getByTestId("insight-n").innerText()).match(/\d+/)![0]);
    expect(impact).toBeLessThan(0);
    expect(count).toBeGreaterThanOrEqual(3);
    impacts.push(impact);
    byId[id] = { n: count, impact };
  }
  expect(impacts).toEqual([...impacts].sort((a, b) => a - b));

  // the rules that read journal fields directly reconcile with SQL, in count and net (to the cent)
  const sqlFor: Record<string, string> = {
    "low-grade": "j.grade in ('C', 'D')",
    "rules-broken": "j.rules_followed in ('partial', 'no')",
  };
  for (const [id, where] of Object.entries(sqlFor)) {
    const [row] = await query<{ n: number; net: number }>(
      `select count(*) as n, coalesce(sum(t.net_pnl), 0) as net from trades t join trade_journal j on j.trade_id = t.id where ${LIVE} and ${where}`,
    );
    if (Number(row.net) < 0 && Number(row.n) >= 3) {
      expect(byId[id], id).toBeDefined();
      expect(byId[id].n).toBe(Number(row.n));
      expect(Math.abs(byId[id].impact - Math.round(Number(row.net) * 100))).toBeLessThanOrEqual(1);
    } else expect(byId[id]).toBeUndefined();
  }

  // the dashboard's top leaks for the same period are the first three, in order
  const top = await cards.evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute("data-insight")));
  await page.goto("/dashboard?period=all");
  const leaks = page.getByTestId("leaks-card").getByTestId("insight");
  await expect(leaks).toHaveCount(3);
  expect(await leaks.evaluateAll((els) => els.map((e) => e.getAttribute("data-insight")))).toEqual(top);
  await page.getByTestId("leaks-card").getByRole("link", { name: "All insights" }).click();
  await expect(page).toHaveURL(/section=insights/);
  await expect(page).not.toHaveURL(/period=/); // all time is the Analytics default
  await expect(page.getByTestId("insight")).toHaveCount(n);
  // from the dashboard's default (30 days) the link keeps the period
  await page.goto("/dashboard");
  const card = page.getByTestId("leaks-card");
  if (await card.count()) {
    await card.getByRole("link", { name: "All insights" }).click();
    await expect(page).toHaveURL(/section=insights/);
    await expect(page).toHaveURL(/period=30d/);
  }
});
