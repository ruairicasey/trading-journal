import { expect, test, type Page } from "@playwright/test";

const cards = (page: Page) => page.getByTestId("strategy-card");
const num = async (page: Page, sel: ReturnType<Page["getByTestId"]>) => Number(await sel.innerText());

test.describe("Playbook (demo data)", () => {
  test("cards add up to the period's closed trades and each links to the same trades", async ({ page }) => {
    await page.goto("/playbook?period=all");
    await expect(page.getByRole("heading", { name: "Playbook" })).toBeVisible();
    const total = Number((await page.getByTestId("playbook-total").innerText()).match(/^(\d+)/)![1]);
    expect(total).toBeGreaterThan(0);

    // the same number of closed trades as the Trades page for all time
    const n = await cards(page).count();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += await num(page, cards(page).nth(i).getByTestId("stat-n"));
    expect(sum).toBe(total);

    // the compliance split adds up to the card
    const first = cards(page).first();
    const firstN = await num(page, first.getByTestId("stat-n"));
    expect(firstN).toBeGreaterThan(0);
    const split = async (id: string) =>
      Number((await first.getByTestId(`split-${id}`).innerText()).match(/\((\d+)\)/)![1]);
    expect((await split("followed")) + (await split("not-followed")) + (await split("unmarked"))).toBe(
      firstN,
    );

    await first.getByTestId("strategy-trades").click();
    await expect(page).toHaveURL(/\/trades\?.*strategy=/);
    await expect(page.getByTestId("trades-showing")).toContainText(`of ${firstN} trade`);

    await page.goto("/trades?tab=closed&period=all");
    await expect(page.getByTestId("trades-showing")).toContainText(`of ${total} trade`);
  });

  for (const period of ["30d", "month", "year"]) {
    test(`${period}: each card's link opens exactly its trades`, async ({ page }) => {
      await page.goto(`/playbook?period=${period}`);
      const n = await cards(page).count();
      let checked = 0;
      for (let i = 0; i < n; i++) {
        const card = cards(page).nth(i);
        const link = card.getByTestId("strategy-trades");
        if (!(await link.count())) continue;
        const k = await num(page, card.getByTestId("stat-n"));
        const href = (await link.getAttribute("href"))!;
        expect(href).toContain("dateBy=exit");
        await page.goto(href);
        await expect(page.getByTestId("trades-showing")).toContainText(`of ${k} trade`);
        await page.goto(`/playbook?period=${period}`);
        checked++;
      }
      // the demo data has trades in the last year at least
      if (period === "year") expect(checked).toBeGreaterThan(0);
    });
  }

  test("write a strategy's rules, see them listed, then clear them", async ({ page }) => {
    await page.goto("/playbook?period=all");
    const card = cards(page).first();
    const id = await card.getAttribute("data-strategy");
    const mine = page.locator(`[data-testid="strategy-card"][data-strategy="${id}"]`);
    await mine.getByTestId("playbook-edit").click();
    const form = mine.getByTestId("playbook-form");
    const oldRules = await form.locator('textarea[name="rules"]').inputValue();
    const oldDesc = await form.locator('textarea[name="description"]').inputValue();
    await form.locator('textarea[name="description"]').fill("E2E sweep and reclaim");
    await form.locator('textarea[name="rules"]').fill("- Bias agrees\n\n2) Stop beyond the sweep");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(mine.getByTestId("rule-text")).toHaveText([
      "Bias agrees",
      "Stop beyond the sweep",
    ]);
    await expect(mine).toContainText("E2E sweep and reclaim");
    await page.reload();
    await expect(mine.getByTestId("strategy-rules").locator("li")).toHaveCount(2);

    // put back what was there
    await mine.getByTestId("playbook-edit").click();
    await form.locator('textarea[name="description"]').fill(oldDesc);
    await form.locator('textarea[name="rules"]').fill(oldRules);
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form).toHaveCount(0);
    await expect(mine).not.toContainText("E2E sweep and reclaim");
  });

  test("the sidebar links to it", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("link", { name: "Playbook" }).first().click();
    await expect(page).toHaveURL(/\/playbook/);
  });
});
