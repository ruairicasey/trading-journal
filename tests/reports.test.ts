import { beforeAll, describe, expect, test } from "vitest";
import { useTempDb } from "./helpers/db";
import { getDb } from "@/server/db/client";
import { runMigrations, seedDefaults } from "@/server/db/bootstrap";
import * as s from "@/server/db/schema";
import { DEFAULT_SESSIONS } from "@/server/db/seed-data";
import { DEMO_ADDRESS, generateDemoHistory } from "@/server/demo/generate";
import { seedDemoJournal } from "@/server/demo/journal";
import { createRng } from "@/server/demo/rng";
import { insertFills, rebuildTrades } from "@/server/reconstruct/persist";
import { closedTrades } from "@/server/db/queries/dashboard";
import { computeKpis } from "@/lib/stats";
import { csvCell, idCell, toCsv } from "@/lib/csv";
import { reportRange } from "@/lib/report-range";
import { localStamp, monthly, monthlyCsv, reportTrades, tradesCsv } from "@/server/reports/export";

const TZ = "Australia/Melbourne";
const END = Date.UTC(2026, 10, 9, 12);
let accountId: string;

/** minimal RFC 4180 parser for the round trip */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  return rows;
}

beforeAll(async () => {
  useTempDb();
  const db = getDb();
  await runMigrations(db);
  await seedDefaults(db);
  accountId = (await db.select().from(s.accounts))[0].id;
  const [w] = await db.insert(s.wallets).values({ accountId, address: DEMO_ADDRESS }).returning();
  const h = generateDemoHistory({ end: END });
  await insertFills(db, w.id, h.fills);
  await rebuildTrades(db, { walletId: w.id, accountId });
  await seedDemoJournal(db, createRng(7), { walletId: w.id, plans: h.plans, sessions: DEFAULT_SESSIONS });
});

describe("csv", () => {
  test("quotes, doubles quotes, and defuses formulas but keeps numbers numeric", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-oops")).toBe("'-oops");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell(NaN)).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell(true)).toBe("yes");
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
    // ids are exact, even with a leading "-" (nanoid uses - and _); anything else is refused
    expect(csvCell(idCell("-_Lq9"))).toBe("-_Lq9");
    expect(() => csvCell(idCell("=1+1"))).toThrow();
  });
});

describe("report data", () => {
  test("the report's trades are the dashboard's closed trades, in count and net", async () => {
    const db = getDb();
    const [rep, dash] = await Promise.all([
      reportTrades(db, accountId, null),
      closedTrades(db, accountId, null),
    ]);
    expect(rep.map((t) => t.id).sort()).toEqual(dash.map((t) => t.id).sort());
    const k = computeKpis(dash);
    expect(rep.reduce((a, t) => a + t.netPnl, 0)).toBeCloseTo(k.net, 6);
  });

  test("monthly rows add up to the period; the trades CSV round-trips every trade and its net", async () => {
    const rep = await reportTrades(getDb(), accountId, null);
    const months = monthly(rep, TZ);
    expect(months.reduce((a, m) => a + m.trades, 0)).toBe(rep.length);
    expect(months.reduce((a, m) => a + m.net, 0)).toBeCloseTo(
      rep.reduce((a, t) => a + t.netPnl, 0),
      6,
    );
    expect(months.map((m) => m.month)).toEqual([...months.map((m) => m.month)].sort());
    for (const m of months) expect(m.wins + m.losses + m.breakeven).toBe(m.trades);

    const csv = parseCsv(tradesCsv(rep, TZ));
    const [head, ...rows] = csv;
    expect(rows).toHaveLength(rep.length);
    const net = head.indexOf("net_pnl");
    expect(
      Math.abs(rows.reduce((a, r) => a + Number(r[net]), 0) - rep.reduce((a, t) => a + t.netPnl, 0)),
    ).toBeLessThan(0.005 * rep.length);
    expect(rows.map((r) => r[0])).toEqual(rep.map((t) => t.id));
    expect(head).toContain(`exit_time (${TZ})`);
    expect(rows[0][head.indexOf(`exit_time (${TZ})`)]).toBe(localStamp(rep[0].exitTime, TZ));

    const mc = parseCsv(monthlyCsv(months));
    expect(mc).toHaveLength(months.length + 1);
  });
});

describe("time zone", () => {
  test("months and custom ranges use the account timezone, across a daylight-saving change", () => {
    const t = (iso: string) => ({ exitTime: Date.parse(iso) });
    const mk = (iso: string) =>
      ({ ...t(iso), netPnl: 1, fees: 0, funding: 0, r: null, outcome: "win" }) as never;
    // 2026-10-31T14:30Z is 1 Nov 01:30 in Melbourne (AEDT)
    expect(
      monthly([mk("2026-10-31T14:30:00Z"), mk("2026-10-31T12:30:00Z")], TZ).map((m) => [m.month, m.trades]),
    ).toEqual([
      ["2026-10", 1],
      ["2026-11", 1],
    ]);
    const now = Date.UTC(2026, 10, 18);
    const c = reportRange({ period: "custom", from: "2026-10-01", to: "2026-10-31" }, now, TZ);
    // 1 Oct 00:00 is AEST (+10) … DST starts 4 Oct … 31 Oct 23:59 is AEDT (+11)
    expect(c.inRange(t("2026-09-30T13:59:59Z"))).toBe(false);
    expect(c.inRange(t("2026-09-30T14:00:00Z"))).toBe(true);
    expect(c.inRange(t("2026-10-31T12:59:59Z"))).toBe(true);
    expect(c.inRange(t("2026-10-31T13:00:00Z"))).toBe(false);
  });
});

describe("as of", () => {
  test("a report (and an export pinned with at=) leaves out trades that exit after its moment", () => {
    const at = Date.UTC(2026, 10, 18, 3);
    for (const period of ["7d", "30d", "week", "month", "year", "all"]) {
      const r = reportRange({ period }, at, TZ);
      expect(r.inRange({ exitTime: at }), period).toBe(true);
      expect(r.inRange({ exitTime: at + 20 * 60_000 }), period).toBe(false);
    }
    // a custom range ending later is still capped; one ending earlier keeps its own end
    expect(
      reportRange({ period: "custom", from: "2026-11-01", to: "2026-11-30" }, at, TZ).inRange({
        exitTime: at + 1,
      }),
    ).toBe(false);
    expect(
      reportRange({ period: "custom", from: "2026-10-01", to: "2026-10-31" }, at, TZ).inRange({
        exitTime: Date.UTC(2026, 10, 2),
      }),
    ).toBe(false);
  });
});

describe("report range", () => {
  const now = Date.UTC(2026, 10, 18, 3);
  test("defaults to this month, accepts the dashboard periods and a custom range", () => {
    const m = reportRange({}, now, TZ);
    expect(m.params.period).toBe("month");
    expect(m.qs).toBe("");
    expect(m.start).not.toBeNull();
    const all = reportRange({ period: "all" }, now, TZ);
    expect(all.start).toBeNull();
    expect(all.qs).toBe("period=all");
    const c = reportRange({ period: "custom", from: "2026-10-01", to: "2026-10-31" }, now, TZ);
    expect(c.label).toBe("2026-10-01 → 2026-10-31");
    expect(c.inRange({ exitTime: Date.UTC(2026, 9, 15) })).toBe(true);
    expect(c.inRange({ exitTime: Date.UTC(2026, 10, 2) })).toBe(false);
    expect(c.qs).toBe("period=custom&from=2026-10-01&to=2026-10-31");
    expect(reportRange({ period: "bogus" }, now, TZ).params.period).toBe("month");
    expect(reportRange({ period: "custom", from: "nope" }, now, TZ).params.period).toBe("month");
  });
});
