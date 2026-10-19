import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { purposeLabel, sourceLabel, tokens, usd } from "../format.ts";
import type { UsageReport } from "../types.ts";
import { Empty, Skeleton } from "../ui.tsx";

const RANGES = [
  { id: "today", label: "Heute" },
  { id: "7d", label: "7 Tage" },
  { id: "month", label: "Monat" },
  { id: "30d", label: "30 Tage" },
] as const;

export default function UsagePage({ stamp }: { stamp: number }) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("month");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let gone = false;
    setLoading(true);
    api<UsageReport>(`/api/usage?range=${range}`)
      .then((body) => {
        if (!gone) {
          setReport(body);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!gone) {
          setError(caught instanceof Error ? caught.message : "Kosten nicht geladen");
        }
      })
      .finally(() => {
        if (!gone) {
          setLoading(false);
        }
      });
    return () => {
      gone = true;
    };
  }, [range, stamp]);

  const max = Math.max(...(report?.byDay.map((day) => day.costUsd) ?? [0]), 0.0001);
  const ratio = report?.budget.ratio ?? 0;

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Kosten</p>
        <h2>Verbrauch</h2>
      </header>
      <div className="seg" role="group" aria-label="Zeitraum">
        {RANGES.map((item) => (
          <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => setRange(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {loading && !report ? <Skeleton lines={4} /> : null}
      {report && report.headline.requests === 0 ? (
        <Empty title="Noch keine Kosten" text="Sobald Jarvis antwortet, landet der Verbrauch hier." />
      ) : null}
      {report ? (
        <>
          <section className="card">
            <span className="kicker">{RANGES.find((item) => item.id === range)?.label}</span>
            <strong>{usd(report.headline.costUsd)}</strong>
            <p>
              {tokens(report.headline.promptTokens + report.headline.completionTokens)} Tokens
              {report.headline.errors ? ` · ${report.headline.errors} Fehler` : ""}
            </p>
            {report.budget.limitUsd ? (
              <div className="meter" role="meter" aria-label="Monatsbudget" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, ratio) * 100)}>
                <span data-level={report.budget.level} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
              </div>
            ) : (
              <p>Kein Monatsbudget. Dafür gibt es JARVIS_MONTHLY_BUDGET_USD.</p>
            )}
            <p>Monat bisher {usd(report.month.costUsd)} · heute {usd(report.today.costUsd)}</p>
          </section>
          <section className="card">
            <span className="kicker">30 Tage</span>
            <svg className="bars" viewBox="0 0 240 80" role="img" aria-label="Kosten der letzten 30 Tage">
              {report.byDay.map((day, index) => {
                const height = (day.costUsd / max) * 70;
                const x = (index * 240) / report.byDay.length;
                const width = 240 / report.byDay.length - 2;
                return <rect key={day.date} x={x} y={76 - height} width={Math.max(width, 1)} height={Math.max(height, day.costUsd > 0 ? 1.5 : 0)} rx="1" />;
              })}
            </svg>
          </section>
          <section className="card">
            <span className="kicker">Quelle</span>
            {Object.entries(report.bySource).map(([key, totals]) => (
              <div key={key} className="split">
                <span>{sourceLabel(key)}</span>
                <span>{usd(totals.costUsd)}</span>
              </div>
            ))}
            <span className="kicker">Zweck</span>
            {Object.entries(report.byPurpose).map(([key, totals]) => (
              <div key={key} className="split">
                <span>{purposeLabel(key)}</span>
                <span>{usd(totals.costUsd)}</span>
              </div>
            ))}
          </section>
          <p className="muted">Die Beträge sind Schätzungen aus der Preistabelle, nicht die Rechnung von xAI.</p>
        </>
      ) : null}
    </div>
  );
}
