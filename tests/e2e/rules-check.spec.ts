import { createClient, type InValue } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { DEMO_DB_FILE } from "../../scripts/demo-env";

async function sql(q: string, args: InValue[] = []) {
  const db = createClient({ url: `file:${DEMO_DB_FILE}` });
  try {
    return (await db.execute({ sql: q, args })).rows;
  } finally {
    db.close();
  }
}

test("review flow: tick a strategy's rules, the answer follows, and the playbook counts each rule", async ({
  page,
}) => {
  // a strategy with two rules (written straight to the demo DB; the playbook editor has its own test)
  const [st] = await sql(
    "select id, label, rules from vocab_items where kind = 'strategy' and archived = 0 order by sort limit 1",
  );
  const strategyId = String(st.id);
  const label = String(st.label);
  await sql("update vocab_items set rules = ? where id = ?", [
    "Bias agrees\nStop beyond the sweep",
    strategyId,
  ]);

  let tradeId: string | null = null;
  let before: Record<string, unknown> | null = null;
  try {
    // the newest week with unreviewed trades
    for (let i = 0; i < 12 && !tradeId; i++) {
      const day = new Date(Date.now() - i * 7 * 86_400_000).toISOString().slice(0, 10);
      await page.goto(`/dashboard?week=${day}`);
      const link = page.getByTestId("review-week");
      if ((await link.count()) === 0) continue;
      await link.click();
      tradeId = await page.getByTestId("review-trade").getAttribute("data-trade-id");
    }
    expect(tradeId).not.toBeNull();
    [before] = (await sql(
      "select strategy_id, rules_followed, rules_check, reviewed_at from trade_journal where trade_id = ?",
      [tradeId],
    )) as unknown as Record<string, unknown>[];

    await page.getByRole("combobox", { name: "Strategy" }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
    const list = page.getByTestId("rules-checklist");
    await expect(list.getByRole("listitem")).toHaveCount(2);
    const answer = (name: string) =>
      page.getByRole("radiogroup", { name: "Rules followed" }).getByRole("radio", { name });
    const mark = (rule: string, m: "Kept" | "Broke") =>
      list.getByRole("group", { name: rule }).getByRole("button", { name: m });
    const answered = await page
      .getByRole("radiogroup", { name: "Rules followed" })
      .getByRole("radio", { checked: true })
      .count();

    // one rule marked: not every rule judged yet, so the answer is left alone
    await mark("Bias agrees", "Kept").click();
    await expect(mark("Bias agrees", "Kept")).toHaveAttribute("aria-pressed", "true");
    expect(
      await page
        .getByRole("radiogroup", { name: "Rules followed" })
        .getByRole("radio", { checked: true })
        .count(),
    ).toBe(answered);
    // both marked: the answer follows
    await mark("Stop beyond the sweep", "Kept").click();
    await expect(answer("Yes")).toHaveAttribute("aria-checked", "true");
    await mark("Stop beyond the sweep", "Broke").click();
    await expect(answer("Partial")).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: /^Save ⌘S$/ }).click();
    await expect(page.getByTestId("review-saved")).toBeVisible();
    const [row] = await sql("select rules_followed, rules_check from trade_journal where trade_id = ?", [
      tradeId,
    ]);
    expect(row.rules_followed).toBe("partial");
    expect(JSON.parse(String(row.rules_check))).toEqual({
      strategyId,
      rules: [
        { text: "Bias agrees", kept: true },
        { text: "Stop beyond the sweep", kept: false },
      ],
    });

    await page.goto("/playbook?period=all");
    const card = page.locator(`[data-testid="strategy-card"][data-strategy="${strategyId}"]`);
    await expect(card.getByTestId("rule-kept")).toHaveText(["kept 1 of 1", "kept 0 of 1"]);
  } finally {
    await sql("update vocab_items set rules = ? where id = ?", [st.rules ?? null, strategyId]);
    if (tradeId) {
      if (before)
        await sql(
          "update trade_journal set strategy_id = ?, rules_followed = ?, rules_check = ?, reviewed_at = ? where trade_id = ?",
          [
            before.strategy_id as InValue,
            before.rules_followed as InValue,
            before.rules_check as InValue,
            before.reviewed_at as InValue,
            tradeId,
          ],
        );
      else await sql("delete from trade_journal where trade_id = ?", [tradeId]);
    }
  }
});
