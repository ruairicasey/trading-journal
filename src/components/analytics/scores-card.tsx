import { cn } from "@/lib/utils";
import { CARD, CARD_H2, H2, SECTION } from "@/lib/ui";
import { fmtSignedUsd, pnlClass } from "@/lib/format";
import { DISCIPLINE_CHECKS, type Scores } from "@/lib/analytics/scores";

// scores are read in ink; only the mistake cost (realised money) is red
const band = (s: number | null) => (s === null ? "text-muted-foreground" : "");
const show = (s: number | null) => (s === null ? "—" : String(Math.round(s)));
const pct = (x: number, of: number) => (of ? `${Math.round((x / of) * 100)}%` : "—");

/** Four tiles: discipline, review coverage, compliance (0–100) and mistake cost ($). */
export function ScoresCard({ s, title, plain = false }: { s: Scores; title: string; plain?: boolean }) {
  const c = s.discipline.checks;
  return (
    <section className={plain ? SECTION : CARD} aria-label="Scores" data-testid="scores">
      <h2 className={plain ? H2 : cn("mb-3", CARD_H2)}>{title}</h2>
      <div className={cn("grid grid-cols-2 gap-4", !plain && "lg:grid-cols-4")}>
        <Tile
          id="discipline"
          label="Discipline"
          value={show(s.discipline.score)}
          cls={band(s.discipline.score)}
        >
          {DISCIPLINE_CHECKS.map((k) => (
            <span key={k.id}>
              {k.label} {pct(c[k.id].passed, c[k.id].of)}
            </span>
          ))}
        </Tile>
        <Tile
          id="coverage"
          label="Review coverage"
          value={show(s.coverage.score)}
          cls={band(s.coverage.score)}
        >
          <span data-testid="score-reviewed">
            Reviewed {s.coverage.reviewed} of {s.n}
          </span>
          <span>Exit reason {pct(s.coverage.exitReason, s.n)}</span>
          <span>Process marked {pct(s.coverage.process, s.n)}</span>
          <span>Emotions {pct(s.coverage.emotions, s.n)}</span>
        </Tile>
        <Tile
          id="compliance"
          label="Compliance"
          value={show(s.compliance.score)}
          cls={band(s.compliance.score)}
        >
          <span>
            Rules followed {show(s.compliance.rulesScore)} ({s.compliance.rulesMarked} marked)
          </span>
          <span>
            Process {show(s.compliance.processScore)} ({s.compliance.processMarked} marked)
          </span>
          {s.compliance.score === null && <span>Mark rules or process on your trades to score this.</span>}
        </Tile>
        <Tile
          id="mistakes"
          label="Mistake cost"
          value={s.mistakes.n ? fmtSignedUsd(s.mistakes.cost) : "—"}
          cls={cn("money", pnlClass(s.mistakes.cost))}
        >
          <span data-testid="score-mistake-n">
            {s.mistakes.n} trade{s.mistakes.n === 1 ? "" : "s"} tagged
          </span>
          {s.mistakes.top.map((m) => (
            <span key={m.id}>
              {m.label} ({m.n}) <span className={cn("money", pnlClass(m.net))}>{fmtSignedUsd(m.net)}</span>
            </span>
          ))}
        </Tile>
      </div>
    </section>
  );
}

function Tile({
  id,
  label,
  value,
  cls,
  children,
}: {
  id: string;
  label: string;
  value: string;
  cls: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1" data-testid={`score-${id}`}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("text-2xl font-semibold tabular-nums", cls)} data-testid="score-value">
        {value}
      </span>
      <div className="text-muted-foreground grid gap-0.5 text-[11px] tabular-nums">{children}</div>
    </div>
  );
}
