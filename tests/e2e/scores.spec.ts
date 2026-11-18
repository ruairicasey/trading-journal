import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { DEMO_DB_FILE } from "../../scripts/demo-env";

async function one<T>(sql: string): Promise<T> {
  const db = createClient({ url: `file:${DEMO_DB_FILE}` });
  const r = await db.execute(sql);
  db.close();
  return r.rows[0] as unknown as T;
}
const LIVE =
  "t.deleted_at is null and coalesce(json_extract(t.flags, '$.superseded'), 0) = 0 and t.status = 'closed' and t.exit_time is not null and t.net_pnl is not null";
const money = (s: string) => Math.round(Number(s.replace(/[^0-9.-]/g, "")) * 100);

test("Scores: coverage and mistake cost reconcile with the journal; the dashboard shows the same scores", async ({
  page,
}) => {
  await page.goto("/analytics?section=insights&period=all");
  const card = page.getByTestId("scores");
  await expect(card).toBeVisible();

  const total = await one<{ n: number; reviewed: number }>(
    `select count(*) as n, sum(case when j.reviewed_at is not null then 1 else 0 end) as reviewed from trades t left join trade_journal j on j.trade_id = t.id where ${LIVE}`,
  );
  await expect(card.getByTestId("score-reviewed")).toHaveText(`Reviewed ${total.reviewed} of ${total.n}`);
  const coverage = Number(await card.getByTestId("score-coverage").getByTestId("score-value").innerText());
  expect(coverage).toBe(Math.round((Number(total.reviewed) / Number(total.n)) * 100));

  const f = await one<{ exit: number; emo: number }>(
    `select sum(case when j.exit_reason_id is not null then 1 else 0 end) as exit,
       sum(case when j.emotion_before_id is not null and j.emotion_after_id is not null then 1 else 0 end) as emo
     from trades t left join trade_journal j on j.trade_id = t.id where ${LIVE}`,
  );
  const p = (x: number) => `${Math.round((Number(x) / Number(total.n)) * 100)}%`;
  await expect(card.getByTestId("score-coverage")).toContainText(`Exit reason ${p(f.exit)}`);
  await expect(card.getByTestId("score-coverage")).toContainText(`Emotions ${p(f.emo)}`);

  const m = await one<{ n: number; net: number }>(
    `select count(*) as n, coalesce(sum(t.net_pnl), 0) as net from trades t where ${LIVE}
       and exists (select 1 from trade_vocab v where v.trade_id = t.id and v.kind = 'mistake')`,
  );
  await expect(card.getByTestId("score-mistake-n")).toHaveText(
    `${m.n} trade${Number(m.n) === 1 ? "" : "s"} tagged`,
  );
  if (Number(m.n) > 0) {
    const shown = money(await card.getByTestId("score-mistakes").getByTestId("score-value").innerText());
    expect(Math.abs(shown - Math.round(Number(m.net) * 100))).toBeLessThanOrEqual(1);
  }

  for (const id of ["discipline", "coverage", "compliance"]) {
    const v = await card.getByTestId(`score-${id}`).getByTestId("score-value").innerText();
    if (v !== "—") (expect(Number(v)).toBeGreaterThanOrEqual(0), expect(Number(v)).toBeLessThanOrEqual(100));
  }
  const values = await card.getByTestId("score-value").allInnerTexts();

  await page.goto("/dashboard?period=all");
  await expect(page.getByTestId("scores").getByTestId("score-value")).toHaveText(values);
});
