import type { Summary } from "../lib/deck.js";

export function Tracker({ summary }: { summary: Summary }) {
  const label = summary.byLevel.map((l) => `${l.name} ${l.count}`).join(", ");
  return (
    <section className="tracker" aria-label="Progress">
      <div>
        <div className="tracker-big">{summary.confidentPct}%</div>
        <div className="tracker-label">
          confident or better · {summary.confident} of {summary.total}
        </div>
      </div>
      <div className="tracker-bars">
        <div className="levels-bar" role="img" aria-label={label}>
          {summary.byLevel
            .filter((l) => l.count > 0)
            .map((l) => (
              <span key={l.name} style={{ flex: `${l.count} 1 0`, background: l.color }} />
            ))}
        </div>
        <div className="levels-legend">
          {summary.byLevel.map((l) => (
            <span key={l.name}>
              <span className="swatch" style={{ background: l.color }} />
              {l.name} <span className="mono" style={{ color: "var(--ink)" }}>{l.count}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="tracker-stats">
        <div>
          <div className="stat-num">{summary.prep}</div>
          <div className="stat-label">to prep now</div>
        </div>
        <div>
          <div className="stat-num">{summary.fadingWeek}</div>
          <div className="stat-label">fade this week</div>
        </div>
      </div>
    </section>
  );
}
