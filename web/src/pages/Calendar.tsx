import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import { addCivilDays, berlinParts, mondayOf, monthGrid } from "@jarvis/dates.ts";
import { swipeAxis } from "@jarvis/gesture.ts";
import { api } from "../api.ts";
import { clock, longDay, repeatLabel } from "../format.ts";
import { getLocale, useI18n } from "../i18n/index.ts";
import type { CalendarItem } from "../types.ts";
import { Empty, Skeleton, pulse } from "../ui.tsx";

const DOW_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DOW_EN = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const START_HOUR = 7;
const END_HOUR = 22;
const HOUR_PX = 52;

type Draft = {
  taskId?: string;
  titel: string;
  date: string;
  time: string;
  repeat: string;
};

export default function CalendarPage({ revision }: { revision: number }) {
  const t = useI18n();
  const now = berlinParts(new Date());
  const [cursor, setCursor] = useState({ year: now.year, month: now.month });
  const [selected, setSelected] = useState(now.key);
  const [span, setSpan] = useState<"month" | "week">("month");
  const [pane, setPane] = useState<"month" | "day">("month");
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const hold = useRef<number | null>(null);

  const grid = monthGrid(cursor.year, cursor.month);
  const weekStart = mondayOf(selected);
  const from = span === "week" || pane === "day" ? addCivilDays(weekStart, -1) : (grid[0]?.key ?? now.key);
  const to = span === "week" || pane === "day" ? addCivilDays(weekStart, 8) : addCivilDays(grid.at(-1)?.key ?? now.key, 1);
  const dow = getLocale() === "en" ? DOW_EN : DOW_DE;

  useEffect(() => {
    let gone = false;
    setLoading(true);
    api<{ items: CalendarItem[] }>(
      `/api/calendar?from=${encodeURIComponent(`${from}T00:00:00`)}&to=${encodeURIComponent(`${to}T00:00:00`)}`,
    )
      .then((body) => {
        if (!gone) {
          setItems(body.items);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!gone) {
          setError(caught instanceof Error ? caught.message : t("cal.failLoad"));
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
  }, [from, to, revision, stamp, t]);

  const marks = new Set(items.map((item) => berlinParts(new Date(item.faelligAm)).key));
  const dayItems = items
    .filter((item) => berlinParts(new Date(item.faelligAm)).key === selected)
    .sort((a, b) => a.faelligAm.localeCompare(b.faelligAm));
  const weekDays = Array.from({ length: 7 }, (_, index) => addCivilDays(weekStart, index));
  const title = new Intl.DateTimeFormat(getLocale() === "en" ? "en-GB" : "de-DE", {
    month: "long",
    year: "numeric",
  }).format(new Date(cursor.year, cursor.month - 1, 1));

  function openCreate(date: string, time: string) {
    pulse();
    setFormError(null);
    setDraft({ titel: "", date, time, repeat: "" });
  }

  function openEdit(item: CalendarItem) {
    const parts = berlinParts(new Date(item.faelligAm));
    setFormError(null);
    setDraft({
      taskId: item.taskId,
      titel: item.titel,
      date: parts.key,
      time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
      repeat: item.wiederholung ?? "",
    });
  }

  async function save() {
    if (!draft) {
      return;
    }
    const titel = draft.titel.trim();
    if (!titel) {
      return;
    }
    setFormError(null);
    const faelligAm = `${draft.date}T${draft.time || "18:00"}`;
    try {
      if (draft.taskId) {
        await api(`/api/tasks/${draft.taskId}`, {
          method: "PATCH",
          body: JSON.stringify({
            titel,
            faelligAm,
            wiederholung: draft.repeat || null,
          }),
        });
      } else {
        await api("/api/calendar", {
          method: "POST",
          body: JSON.stringify({
            titel,
            faelligAm,
            ...(draft.repeat ? { wiederholung: draft.repeat } : {}),
          }),
        });
      }
      setSelected(draft.date);
      setDraft(null);
      setStamp((value) => value + 1);
      pulse();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : draft.taskId ? t("cal.failSave") : t("cal.fail"));
    }
  }

  async function remove() {
    if (!draft?.taskId) {
      return;
    }
    await api(`/api/tasks/${draft.taskId}`, { method: "DELETE" });
    setDraft(null);
    setStamp((value) => value + 1);
    pulse(16);
  }

  function shiftMonth(delta: number) {
    const date = new Date(Date.UTC(cursor.year, cursor.month - 1 + delta, 1));
    setCursor({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  }

  function shiftDay(delta: number) {
    const next = addCivilDays(selected, delta);
    const [year, month] = next.split("-").map(Number);
    setSelected(next);
    setCursor({ year: year ?? now.year, month: month ?? now.month });
  }

  function goToday() {
    setCursor({ year: now.year, month: now.month });
    setSelected(now.key);
    if (span === "week") {
      setPane("day");
    }
  }

  return (
    <div
      data-gesture="calendar"
      onPointerDown={(event) => {
        gesture.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = gesture.current;
        gesture.current = null;
        if (!start) {
          return;
        }
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (pane === "day" && swipeAxis(dx, dy) === "x" && dx > 0 && start.x <= 28) {
          setPane("month");
          setSpan("month");
          return;
        }
        if (swipeAxis(dx, dy) !== "x") {
          return;
        }
        if (pane === "day" || span === "week") {
          shiftDay(dx < 0 ? 1 : -1);
        } else {
          shiftMonth(dx < 0 ? 1 : -1);
        }
      }}
      onPointerCancel={() => {
        gesture.current = null;
      }}
    >
      <header className="top">
        <div>
          <p className="eyebrow">{t("cal.kicker")}</p>
          <h1>{pane === "day" ? longDay(selected) : title}</h1>
        </div>
        <button type="button" className="text-btn" onClick={() => openCreate(selected, "18:00")}>
          {t("cal.new")}
        </button>
      </header>
      <div className="seg" role="group" aria-label={t("cal.view")}>
        <button
          type="button"
          aria-pressed={span === "month" && pane === "month"}
          onClick={() => {
            setSpan("month");
            setPane("month");
          }}
        >
          {t("cal.month")}
        </button>
        <button
          type="button"
          aria-pressed={span === "week" || pane === "day"}
          onClick={() => {
            setSpan("week");
            setPane("day");
          }}
        >
          {t("cal.week")}
        </button>
      </div>
      <div className="cal-head">
        <button type="button" className="icon-btn" aria-label={t("cal.prev")} onClick={() => (pane === "day" || span === "week" ? shiftDay(-1) : shiftMonth(-1))}>
          ‹
        </button>
        <button type="button" className="text-btn ghost" onClick={goToday}>
          {t("common.today")}
        </button>
        <button type="button" className="icon-btn" aria-label={t("cal.next")} onClick={() => (pane === "day" || span === "week" ? shiftDay(1) : shiftMonth(1))}>
          ›
        </button>
      </div>
      {error ? (
        <div className="banner bad" role="alert">
          {error}
        </div>
      ) : null}
      {pane === "month" && span === "month" ? (
        <div className="grid cal-stage" role="grid" aria-label={t("cal.grid")}>
          {dow.map((label) => (
            <span key={label} className="dow">
              {label}
            </span>
          ))}
          {grid.map((cell) => (
            <button
              key={cell.key}
              type="button"
              className={`${cell.inMonth ? "" : "out"} ${cell.key === now.key ? "today" : ""} ${cell.key === selected ? "on" : ""}`}
              aria-pressed={cell.key === selected}
              onClick={() => {
                setSelected(cell.key);
                const [year, month] = cell.key.split("-").map(Number);
                setCursor({ year: year ?? cursor.year, month: month ?? cursor.month });
                setPane("day");
              }}
            >
              {Number(cell.key.slice(8))}
              {marks.has(cell.key) ? <i className="mark" /> : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="cal-stage">
          <button type="button" className="text-btn ghost" onClick={() => { setPane("month"); setSpan("month"); }}>
            {t("cal.back")}
          </button>
          {span === "week" ? (
            <div className="days">
              {weekDays.map((key) => (
                <button key={key} type="button" className={key === selected ? "on" : ""} aria-pressed={key === selected} onClick={() => setSelected(key)}>
                  <span className="dow">{dow[(new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7]}</span>
                  {Number(key.slice(8))}
                </button>
              ))}
            </div>
          ) : null}
          {loading ? <Skeleton lines={3} /> : null}
          <HourGrid
            items={dayItems}
            today={selected === now.key}
            now={now}
            onCreate={(hour) => openCreate(selected, `${String(hour).padStart(2, "0")}:00`)}
            onEdit={openEdit}
            hold={hold}
          />
          {!loading && dayItems.length === 0 ? <Empty title={t("cal.emptyTitle")} text={t("cal.emptyBody")} /> : null}
        </div>
      )}
      <Drawer.Root open={draft !== null} onOpenChange={(open) => { if (!open) setDraft(null); }} noBodyStyles>
        <Drawer.Portal>
          <Drawer.Overlay className="sheet-root" />
          <Drawer.Content className="sheet surface" aria-label={draft?.taskId ? t("cal.sheetEdit") : t("cal.sheetNew")}>
            <Drawer.Handle className="vaul-handle" />
            <h2>{draft?.taskId ? t("cal.sheetEdit") : t("cal.sheetNew")}</h2>
            {draft ? (
              <form
                data-no-swipe
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <label className="field">
                  <span>{t("cal.fieldTitle")}</span>
                  <input value={draft.titel} onChange={(event) => setDraft({ ...draft, titel: event.target.value })} required maxLength={200} />
                </label>
                <label className="field">
                  <span>{t("cal.fieldDate")}</span>
                  <input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} required />
                </label>
                <label className="field">
                  <span>{t("cal.fieldTime")}</span>
                  <input type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} required />
                </label>
                <label className="field">
                  <span>{t("cal.repeat")}</span>
                  <select value={draft.repeat} onChange={(event) => setDraft({ ...draft, repeat: event.target.value })}>
                    <option value="">{t("common.once")}</option>
                    <option value="taeglich">{t("common.daily")}</option>
                    <option value="woechentlich">{t("common.weekly")}</option>
                  </select>
                </label>
                {formError ? <p role="alert">{formError}</p> : null}
                <div className="actions">
                  <button type="submit" className="text-btn">{draft.taskId ? t("common.save") : t("common.add")}</button>
                  {draft.taskId ? (
                    <button type="button" className="text-btn ghost" onClick={() => void remove()}>
                      {t("cal.delete")}
                    </button>
                  ) : null}
                </div>
              </form>
            ) : null}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}

function HourGrid({
  items,
  today,
  now,
  onCreate,
  onEdit,
  hold,
}: {
  items: CalendarItem[];
  today: boolean;
  now: { hour: number; minute: number };
  onCreate: (hour: number) => void;
  onEdit: (item: CalendarItem) => void;
  hold: { current: number | null };
}) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, index) => START_HOUR + index);
  const nowMin = now.hour * 60 + now.minute;
  const top = ((nowMin - START_HOUR * 60) / 60) * HOUR_PX;
  return (
    <div className="hour-grid" style={{ height: hours.length * HOUR_PX }}>
      {hours.map((hour) => (
        <button
          key={hour}
          type="button"
          className="hour"
          onPointerDown={() => {
            hold.current = window.setTimeout(() => onCreate(hour), 480);
          }}
          onPointerUp={() => {
            if (hold.current) {
              window.clearTimeout(hold.current);
            }
          }}
          onPointerLeave={() => {
            if (hold.current) {
              window.clearTimeout(hold.current);
            }
          }}
          style={{ top: (hour - START_HOUR) * HOUR_PX }}
        >
          {String(hour).padStart(2, "0")}:00
        </button>
      ))}
      {items.map((item) => {
        const parts = berlinParts(new Date(item.faelligAm));
        const minutes = Math.min(END_HOUR * 60, Math.max(START_HOUR * 60, parts.hour * 60 + parts.minute));
        return (
          <button
            key={`${item.taskId}-${item.faelligAm}`}
            type="button"
            className="event-block"
            style={{ top: ((minutes - START_HOUR * 60) / 60) * HOUR_PX + 8 }}
            onClick={() => onEdit(item)}
          >
            {clock(item.faelligAm)} {item.titel}
            <span className="sr-only">{repeatLabel(item.wiederholung)}</span>
          </button>
        );
      })}
      {today && top >= 0 && top <= hours.length * HOUR_PX ? <div className="now-line" style={{ top }} /> : null}
    </div>
  );
}
