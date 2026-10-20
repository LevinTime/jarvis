import { layoutDayBar, minutesInBerlin, type DayEvent } from "@jarvis/day-timeline.ts";
import { useI18n } from "../i18n/index.ts";

function hhmm(total: number): string {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function DayBar({ events, now }: { events: readonly DayEvent[]; now: Date }) {
  const t = useI18n();
  const bar = layoutDayBar({ events, nowMin: minutesInBerlin(now) });
  const ticks = bar.hours.filter((hour) => hour === 7 || hour === 22 || hour % 3 === 1);
  return (
    <div>
      <div className="day-bar" role="img" aria-label={t("widget.events")}>
        <div className="day-hours">
          {ticks.map((hour) => (
            <span key={hour}>{String(hour).padStart(2, "0")}</span>
          ))}
        </div>
        <div className="day-track">
          {bar.blocks.map((block) => (
            <span key={block.id} className="day-block" style={{ left: `${block.left}%`, width: `${block.width}%` }}>
              {block.title}
            </span>
          ))}
          {bar.nowLeft === null ? null : (
            <span className="day-now" style={{ left: `${bar.nowLeft}%` }} aria-hidden="true" />
          )}
        </div>
      </div>
      <p className="day-next">
        <span className="kicker">{t("widget.next")}</span>{" "}
        {bar.next ? `${hhmm(bar.next.startMin)} ${bar.next.title}` : t("widget.noNext")}
      </p>
    </div>
  );
}
