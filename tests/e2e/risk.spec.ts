import { expect, test, type Page } from "@playwright/test";

const values = (page: Page) => page.getByTestId("risk-card").getByTestId("risk-value").allInnerTexts();

test("Risk-adjusted card: same figures on the dashboard, Analytics → Risk and Reports for the same period", async ({
  page,
}) => {
  const url = "period=custom&from=2026-03-01";
  await page.goto(`/dashboard?${url}`);
  const card = page.getByTestId("risk-card");
  await expect(card).toBeVisible();
  const dash = await values(page);
  expect(dash).toHaveLength(9);
  const sample = await card.getByTestId("risk-sample").innerText();
  const [, days, trades] = sample.match(/(\d+) days? with capital · (\d+) trades?/)!;
  expect(Number(days)).toBeGreaterThan(0);
  // the trade count is the period's closed trades: the KPI card's wins + losses + breakevens
  const wlb = (await page.getByTestId("kpi-winrate").innerText()).match(/(\d+)W \/ (\d+)L \/ (\d+)BE/)!;
  expect(Number(wlb[1]) + Number(wlb[2]) + Number(wlb[3])).toBe(Number(trades));
  for (const id of ["sharpe", "sortino", "calmar", "sqn", "payoff"]) {
    const v = await card.getByTestId(`risk-${id}`).getByTestId("risk-value").innerText();
    expect(v === "—" || Number.isFinite(Number(v)), id).toBe(true);
  }

  await page.goto(`/analytics?section=risk&${url}`);
  expect(await values(page)).toEqual(dash);
  await expect(page.getByTestId("risk-card").getByTestId("risk-sample")).toHaveText(sample);

  // 7D starts mid-day: the card's trade count still equals the KPI card's
  await page.goto("/dashboard?period=7d");
  if (await page.getByTestId("risk-card").count()) {
    const t7 = Number((await page.getByTestId("risk-sample").innerText()).match(/(\d+) trades?/)![1]);
    const k7 = (await page.getByTestId("kpi-winrate").innerText()).match(/(\d+)W \/ (\d+)L \/ (\d+)BE/)!;
    expect(t7).toBe(Number(k7[1]) + Number(k7[2]) + Number(k7[3]));
  }

  await page.goto(`/reports?${url}`);
  expect(await values(page)).toEqual(dash);
  await expect(page.getByTestId("report-meta")).toContainText(`${trades} closed trade`);
});
