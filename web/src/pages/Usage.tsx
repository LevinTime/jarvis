import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { purposeLabel, sourceLabel, tokens, usd } from "../format.ts";
import type { UsageReport } from "../types.ts";
import { useI18n } from "../i18n/index.ts";
import { Empty, Skeleton } from "../ui.tsx";

const RANGES = ["today", "7d", "month", "30d"] as const;

function rangeLabel(id: (typeof RANGES)[number], tr: (key: string) => string): string {
  switch (id) {
    case "today":
      return tr("usage.today");
    case "7d":
      return tr("usage.7d");
    case "month":
      return tr("usage.month");
    case "30d":
      return tr("usage.30d");
  }
}

export default function UsagePage({ stamp }: { stamp: number }) {
  const t = useI18n();
  const [range, setRange] = useState<(typeof RANGES)[number]>("month");
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
          setError(caught instanceof Error ? caught.message : t("usage.fail"));
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
        <p className="eyebrow">{t("usage.kicker")}</p>
        <h2>{t("usage.title")}</h2>
      </header>
      <div className="seg" role="group" aria-label={t("usage.range")}>
        {RANGES.map((item) => (
          <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>
            {rangeLabel(item, t)}
          </button>
        ))}
      </div>
      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {loading && !report ? <Skeleton lines={4} /> : null}
      {report && report.headline.requests === 0 ? (
        <Empty title={t("usage.emptyTitle")} text={t("usage.emptyBody")} />
      ) : null}
      {report ? (
        <>
          <section className="card">
            <span className="kicker">{rangeLabel(range, t)}</span>
            <strong>{usd(report.headline.costUsd)}</strong>
            <p>
              {t("usage.tokens", { count: tokens(report.headline.promptTokens + report.headline.completionTokens) })}
              {report.headline.errors ? ` · ${t("usage.errors", { count: report.headline.errors })}` : ""}
            </p>
            {report.budget.limitUsd ? (
              <div className="meter" role="meter" aria-label={t("usage.budget")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, ratio) * 100)}>
                <span data-level={report.budget.level} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
              </div>
            ) : (
              <p>{t("usage.noBudget")}</p>
            )}
            {report.budget.level === "over" ? (
              <p>{t("usage.over")}</p>
            ) : report.budget.level === "warn" ? (
              <p>{t("usage.warn")}</p>
            ) : null}
            <p>{t("usage.soFar", { month: usd(report.month.costUsd), today: usd(report.today.costUsd) })}</p>
          </section>
          <section className="card">
            <span className="kicker">{t("usage.days")}</span>
            <svg className="bars" viewBox="0 0 240 80" role="img" aria-label={t("usage.chart")}>
              {report.byDay.map((day, index) => {
                const height = (day.costUsd / max) * 70;
                const x = (index * 240) / report.byDay.length;
                const width = 240 / report.byDay.length - 2;
                return <rect key={day.date} x={x} y={76 - height} width={Math.max(width, 1)} height={Math.max(height, day.costUsd > 0 ? 1.5 : 0)} rx="1" />;
              })}
            </svg>
          </section>
          <section className="card">
            <span className="kicker">{t("usage.source")}</span>
            {Object.entries(report.bySource).map(([key, totals]) => (
              <div key={key} className="split">
                <span>{sourceLabel(key)}</span>
                <span>{usd(totals.costUsd)}</span>
              </div>
            ))}
            <span className="kicker">{t("usage.purpose")}</span>
            {Object.entries(report.byPurpose).map(([key, totals]) => (
              <div key={key} className="split">
                <span>{purposeLabel(key)}</span>
                <span>{usd(totals.costUsd)}</span>
              </div>
            ))}
          </section>
          <p className="muted">{t("usage.estimate")}</p>
        </>
      ) : null}
    </div>
  );
}
