import { createClient } from "@libsql/client";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_DB_FILE } from "../../scripts/demo-env";

async function query<T>(sql: string, args: (string | number)[] = []): Promise<T[]> {
  const db = createClient({ url: `file:${DEMO_DB_FILE}` });
  const r = await db.execute({ sql, args });
  db.close();
  return r.rows as unknown as T[];
}
const LIVE = "deleted_at is null and coalesce(json_extract(flags, '$.superseded'), 0) = 0";

const tabCount = async (page: Page, tab: string) =>
  Number(await page.getByRole("navigation", { name: "Trade tabs" }).getByRole("link", { name: new RegExp(`^${tab}`) }).locator("span").innerText());
const usd = async (page: Page, id: string) => {
  const loc = id === "kpi-net" ? page.getByTestId(id).locator("div").nth(1) : page.getByTestId(id);
  return Math.round(Number((await loc.innerText()).replace(/[^0-9.-]/g, "")) * 100);
};
async function pickWallet(page: Page, name: string) {
  await page.getByRole("button", { name: /Trading Journal/ }).click();
  await page.getByRole("group", { name: "Wallets" }).getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
  if (name === "All wallets") await expect(page.getByTestId("wallet-scope")).toHaveCount(0);
  else await expect(page.getByTestId("wallet-scope")).toHaveText(`Wallet: ${name}`);
}

test("pick a wallet: every page shows only its trades, and the wallets add up to all wallets", async ({ page }) => {
  const wallets = await query<{ id: string; label: string; n: number; closed: number }>(
    `select w.id, w.label, (select count(*) from trades t where t.wallet_id = w.id and ${LIVE}) as n,
       (select count(*) from trades t where t.wallet_id = w.id and t.status = 'closed' and ${LIVE}) as closed
     from wallets w order by w.created_at, w.id`,
  );
  expect(wallets.map((w) => w.label)).toEqual(["Demo", "Scalps"]);
  // manual trades (other specs add some) and trades from another account's wallet count in "All wallets" only
  const NO_WALLET_HERE = "(wallet_id is null or wallet_id not in (select w.id from wallets w where w.account_id = trades.account_id))";
  const [manual] = await query<{ n: number; net: number }>(
    `select count(*) as n, (select coalesce(sum(net_pnl), 0) from trades where ${NO_WALLET_HERE} and status = 'closed'
       and exit_time is not null and net_pnl is not null and ${LIVE}) as net from trades where ${NO_WALLET_HERE} and ${LIVE}`,
  );

  // All wallets: no badge; each row says which wallet it is from
  await page.goto("/trades");
  await expect(page.getByTestId("wallet-scope")).toHaveCount(0);
  const all = await tabCount(page, "All");
  expect(all).toBe(Number(wallets[0].n) + Number(wallets[1].n) + Number(manual.n));
  await expect(page.getByTestId("trade-row").first().getByTestId("trade-wallet")).toHaveText(/Demo|Scalps|Manual/);
  await page.goto("/dashboard?period=all");
  const allNet = await usd(page, "kpi-net");
  const allBal = await usd(page, "balance-now");
  const allDep = await usd(page, "balance-deposited");

  const per: { net: number; bal: number; dep: number }[] = [];
  for (const w of wallets) {
    await pickWallet(page, w.label);
    await page.goto("/trades");
    expect(await tabCount(page, "All")).toBe(Number(w.n));
    expect(await tabCount(page, "Closed")).toBe(Number(w.closed));
    const labels = await page.getByTestId("trade-row").getByTestId("trade-wallet").allInnerTexts();
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels)).toEqual(new Set([w.label]));
    await page.goto("/analytics?period=all");
    await expect(page.getByTestId("wallet-scope")).toHaveText(`Wallet: ${w.label}`);
    await page.goto("/dashboard?period=all");
    await expect(page.getByTestId("scope-label")).toContainText(`· ${w.label}`);
    per.push({ net: await usd(page, "kpi-net"), bal: await usd(page, "balance-now"), dep: await usd(page, "balance-deposited") });
  }
  // the parts add up to the whole (each figure is rounded to the cent once: allow a cent per part)
  expect(Math.abs(per[0].net + per[1].net + Math.round(Number(manual.net) * 100) - allNet)).toBeLessThanOrEqual(3);
  expect(Math.abs(per[0].bal + per[1].bal - allBal)).toBeLessThanOrEqual(2);
  // the 4,000 moved from the main wallet into the sub-account is a transfer for each wallet, not for the account
  expect(per[1].dep).toBe(400_000);
  expect(per[0].dep + per[1].dep).toBe(allDep);

  await pickWallet(page, "All wallets");
  await page.goto("/trades");
  expect(await tabCount(page, "All")).toBe(all);
});

test("rename a wallet and move it to another account with its trades, then back", async ({ page }) => {
  // n: live trades (what the app counts and reports); every: all of them, deleted ones too (all of them move)
  const [sub] = await query<{ id: string; account: string; n: number; every: number }>(
    `select w.id, w.account_id as account, (select count(*) from trades t where t.wallet_id = w.id and ${LIVE}) as n,
       (select count(*) from trades t where t.wallet_id = w.id) as every from wallets w where w.label = 'Scalps'`,
  );
  const otherId = "e2e-second-account";
  await query("insert or ignore into accounts (id, name, created_at) values (?, 'E2E second', ?)", [otherId, Date.now()]);
  try {
    await page.goto("/settings/wallets");
    const card = page.getByTestId("wallet-details").nth(1); // cards are in the order the wallets were added
    await expect(card.getByLabel("Name")).toHaveValue("Scalps");
    await card.getByLabel("Name").fill("Scalps 2");
    await card.getByRole("button", { name: "Save details" }).click();
    await expect.poll(async () => (await query<{ label: string }>("select label from wallets where id = ?", [sub.id]))[0].label).toBe("Scalps 2");

    const form = card;
    await form.getByRole("combobox", { name: "Journal account" }).click();
    await page.getByRole("option", { name: "E2E second" }).click();
    await form.getByRole("button", { name: "Save details" }).click();
    await expect(form.getByRole("alert")).toContainText(`its ${sub.n} trades to E2E second?`);
    await form.getByRole("button", { name: "Keep" }).click(); // backs out: nothing moves
    expect((await query<{ a: string }>("select account_id as a from wallets where id = ?", [sub.id]))[0].a).toBe(sub.account);

    await form.getByRole("combobox", { name: "Journal account" }).click();
    await page.getByRole("option", { name: "E2E second" }).click();
    await form.getByRole("button", { name: "Save details" }).click();
    await form.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText(`Moved to E2E second with ${sub.n} trades`)).toBeVisible();
    const [moved] = await query<{ w: number; t: number }>(
      "select (select count(*) from wallets where id = ? and account_id = ?) as w, (select count(*) from trades where wallet_id = ? and account_id = ?) as t",
      [sub.id, otherId, sub.id, otherId],
    );
    expect([Number(moved.w), Number(moved.t)]).toEqual([1, Number(sub.every)]);

    // the demo account now has one wallet: no wallet picker
    await page.getByRole("button", { name: /Trading Journal/ }).click();
    await expect(page.getByRole("menuitem", { name: "Manage accounts" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Wallets" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  } finally {
    // put everything back exactly as it was
    await query("update trades set account_id = ? where wallet_id = ?", [sub.account, sub.id]);
    await query("update wallets set account_id = ?, label = 'Scalps' where id = ?", [sub.account, sub.id]);
    await query("delete from accounts where id = ?", [otherId]);
  }
});
