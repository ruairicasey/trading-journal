import { cn } from "@/lib/utils";
import { fmtSignedUsd, fmtUsd, pnlClass } from "@/lib/format";
import type { LimitState, TodayLimits } from "@/lib/analytics/limits";
import { H2, SECTION } from "@/lib/ui";

const STATE: Record<LimitState, { label: string; cls: string }> = {
  ok: { label: "Within your limits", cls: "bg-subtle text-ink-2" },
  near: { label: "Close to a limit", cls: "bg-gold-tint text-gold-ink" },
  hit: { label: "Stop for today", cls: "bg-gold text-white" },
};

/** Today against the account's risk rules (Settings → Accounts). Days are midnight to midnight in your timezone. */
export function LimitsCard({ t, tz }: { t: TodayLimits; tz: string }) {
  const s = STATE[t.state];
  return (
    <section className={SECTION} aria-label="Today's limits" data-testid="limits-card" data-state={t.state}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={H2}>Today</h2>
        <span
          className={cn("text-13 rounded-full px-2.5 py-0.5 font-medium", s.cls)}
          data-testid="limits-state"
        >
          {s.label}
        </span>
      </header>
      <dl className="border-rule divide-rule divide-y border-y">
        {t.loss && (
          <Row label="Realised today" state={t.loss.state} testId="limits-loss">
            <span className={cn("money", pnlClass(t.net))}>{fmtSignedUsd(t.net)}</span>
            <span className="text-muted-foreground">
              {" "}
              of <span className="money">−{fmtUsd(t.loss.limit)}</span>
            </span>
          </Row>
        )}
        {t.count && (
          <Row label="Trades opened" state={t.count.state} testId="limits-trades">
            {t.trades} <span className="text-muted-foreground">of {t.count.limit}</span>
          </Row>
        )}
        {t.run && (
          <Row label="Losses in a row" state={t.run.state} testId="limits-streak">
            {t.streak} <span className="text-muted-foreground">of {t.run.limit}</span>
          </Row>
        )}
      </dl>
      <p className="text-muted-foreground text-13">
        {t.state === "hit"
          ? "A rule says stop: another trade today would count against your discipline."
          : `Closed trades count once they exit; days run midnight to midnight (${tz}).`}
      </p>
    </section>
  );
}

function Row({
  label,
  state,
  testId,
  children,
}: {
  label: string;
  state: LimitState;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5" data-testid={testId} data-state={state}>
      <dt className="text-ink-2 text-sm">{label}</dt>
      <dd className={cn("text-15 tabular-nums", state !== "ok" && "text-gold-ink font-medium")}>
        {children}
      </dd>
    </div>
  );
}
