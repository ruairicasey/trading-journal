import { cn } from "@/lib/utils";
import { fmtSignedUsd, fmtUsd, pnlClass } from "@/lib/format";
import type { GoalHistory, MonthGoals, NetState, TradesState } from "@/lib/analytics/goals";
import { H2, SECTION } from "@/lib/ui";

const NET: Record<NetState, string> = { met: "Met", "on-pace": "On pace", behind: "Behind pace" };
const TRADES: Record<TradesState, string> = {
  ok: "Within",
  near: "1 left",
  at: "At your cap",
  over: "Over your cap",
};

/** This month against the account's goals (Settings → Accounts), with how many of the last six months hit each. */
export function GoalsCard({
  m,
  history,
  tz,
  allWallets = false,
}: {
  m: MonthGoals;
  history: GoalHistory;
  tz: string;
  /** a wallet is picked: say the goals still count every wallet */
  allWallets?: boolean;
}) {
  const month = new Intl.DateTimeFormat("en-AU", { month: "long", timeZone: tz }).format(m.start);
  const hist = [
    history.net && `net ${history.net.hit} of ${history.net.of}`,
    history.trades && `trades ${history.trades.hit} of ${history.trades.of}`,
    history.review && `reviews ${history.review.hit} of ${history.review.of}`,
  ].filter(Boolean);
  return (
    <section className={SECTION} aria-label="Monthly goals" data-testid="goals-card" data-month={m.key}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={H2}>
          {month} goals
          {allWallets && <span className="text-muted-foreground font-normal">, all wallets</span>}
        </h2>
        <span className="text-muted-foreground text-13" data-testid="goals-days-left">
          {m.daysLeft} day{m.daysLeft === 1 ? "" : "s"} left
        </span>
      </header>
      <dl className="border-rule divide-rule divide-y border-y">
        {m.netGoal && (
          <Row label="Net" note={NET[m.netGoal.state]} warn={m.netGoal.state === "behind"} testId="goal-net">
            <span className={cn("money", pnlClass(m.net))}>{fmtSignedUsd(m.net)}</span>
            <span className="text-muted-foreground">
              {" "}
              of <span className="money">{fmtUsd(m.netGoal.target)}</span>
            </span>
            <Bar value={m.net / m.netGoal.target} pace={m.elapsed} />
          </Row>
        )}
        {m.tradesGoal && (
          <Row
            label="Trades opened"
            note={TRADES[m.tradesGoal.state]}
            warn={m.tradesGoal.state === "at" || m.tradesGoal.state === "over"}
            testId="goal-trades"
          >
            {m.opened} <span className="text-muted-foreground">of {m.tradesGoal.cap}</span>
          </Row>
        )}
        {m.reviewGoal && (
          <Row
            label="Reviewed"
            note={m.reviewGoal.pct === null ? "No closed trades" : m.reviewGoal.met ? "Met" : "Below target"}
            warn={m.reviewGoal.pct !== null && !m.reviewGoal.met}
            testId="goal-review"
          >
            {m.reviewed} of {m.closed}
            <span className="text-muted-foreground">
              {" "}
              ({m.reviewGoal.pct === null ? "—" : `${Math.round(m.reviewGoal.pct)}%`}, target{" "}
              {m.reviewGoal.target}%)
            </span>
          </Row>
        )}
      </dl>
      <p className="text-muted-foreground text-13" data-testid="goals-history">
        {history.months
          ? `Last ${history.months === 1 ? "month" : `${history.months} months`}: ${hist.join(", ")} hit.`
          : "Your record shows here once a full month has passed."}
      </p>
    </section>
  );
}

function Row({
  label,
  note,
  warn,
  testId,
  children,
}: {
  label: string;
  note: string;
  warn: boolean;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 py-2.5" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-ink-2 text-sm">{label}</dt>
        <span
          className={cn("text-13", warn ? "text-gold-ink font-medium" : "text-muted-foreground")}
          data-testid={`${testId}-state`}
        >
          {note}
        </span>
      </div>
      <dd className="text-15 tabular-nums">{children}</dd>
    </div>
  );
}

/** Progress toward the net target, with a tick where you'd be on pace. */
function Bar({ value, pace }: { value: number; pace: number }) {
  const w = Math.max(0, Math.min(1, value));
  return (
    <span className="bg-hover relative mt-1.5 block h-1.5 overflow-hidden rounded-full" aria-hidden="true">
      <span className="bg-ink absolute inset-y-0 left-0" style={{ width: `${w * 100}%` }} />
      <span className="bg-gold absolute inset-y-0 w-0.5" style={{ left: `calc(${pace * 100}% - 1px)` }} />
    </span>
  );
}
