import { expect, test, type Page } from "@playwright/test";

const values = (page: Page) => page.getByTestId("risk-card").getByTestId("risk-value").allInnerTexts();
const closedCount = async (page: Page) => {
  const m = (await page.getByTestId("kpi-winrate").innerText()).match(/(\d+) won, (\d+) lost, (\d+) even/)!;
  return Number(m[1]) + Number(m[2]) + Number(m[3]);
};

test("Risk-adjusted card: same figures on Analytics → Risk and Reports; trade count matches the dashboard", async ({
  page,
}) => {
  const url = "period=custom&from=2026-03-01";
  await page.goto(`/analytics?section=risk&${url}`);
  const card = page.getByTestId("risk-card");
  await expect(card).toBeVisible();
  const risk = await values(page);
  expect(risk).toHaveLength(9);
  const sample = await card.getByTestId("risk-sample").innerText();
  const [, days, trades] = sample.match(/(\d+) days? with capital\D+(\d+) trades?/)!;
  expect(Number(days)).toBeGreaterThan(0);
  for (const id of ["sharpe", "sortino", "calmar", "sqn", "payoff"]) {
    const v = await card.getByTestId(`risk-${id}`).getByTestId("risk-value").innerText();
    expect(v === "—" || Number.isFinite(Number(v)), id).toBe(true);
  }

  // the trade count is the period's closed trades: the dashboard's won + lost + even
  await page.goto(`/dashboard?${url}`);
  await expect(page.getByTestId("risk-card")).toHaveCount(0); // risk lives in Analytics now
  expect(await closedCount(page)).toBe(Number(trades));

  // 7D starts mid-day: the card's trade count still equals the dashboard's
  await page.goto("/analytics?section=risk&period=7d");
  if (await page.getByTestId("risk-card").count()) {
    const t7 = Number((await page.getByTestId("risk-sample").innerText()).match(/(\d+) trades?/)![1]);
    await page.goto("/dashboard?period=7d");
    expect(t7).toBe(await closedCount(page));
  }

  await page.goto(`/reports?${url}`);
  expect(await values(page)).toEqual(risk);
  await expect(page.getByTestId("report-meta")).toContainText(`${trades} closed trade`);
});
