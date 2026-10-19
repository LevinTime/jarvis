import { useEffect, useState } from "react";
import { addCivilDays, berlinParts, mondayOf, monthGrid } from "@jarvis/dates.ts";
import { api } from "../api.ts";
import { clock, longDay, repeatLabel } from "../format.ts";
import type { CalendarItem } from "../types.ts";
import { Empty, Sheet, Skeleton } from "../ui.tsx";

const DOW = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export default function CalendarPage({ revision }: { revision: number }) {
  const now = berlinParts(new Date());
  const [cursor, setCursor] = useState({ year: now.year, month: now.month });
  const [selected, setSelected] = useState(now.key);
  const [mode, setMode] = useState<"month" | "week">("month");
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [titel, setTitel] = useState("");
  const [due, setDue] = useState(`${now.key}T18:00`);
  const [repeat, setRepeat] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const grid = monthGrid(cursor.year, cursor.month);
  const weekStart = mondayOf(selected);
  const from = mode === "week" ? weekStart : (grid[0]?.key ?? now.key);
  const to = mode === "week" ? addCivilDays(weekStart, 7) : addCivilDays(grid.at(-1)?.key ?? now.key, 1);

  useEffect(() => {
    let gone = false;
    setLoading(true);
    api<{ items: CalendarItem[] }>(`/api/calendar?from=${encodeURIComponent(`${from}T00:00:00`)}&to=${encodeURIComponent(`${to}T00:00:00`)}`)
      .then((body) => {
        if (!gone) {
          setItems(body.items);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!gone) {
          setError(caught instanceof Error ? caught.message : "Kalender nicht geladen");
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
  }, [from, to, revision]);

  const marks = new Set(items.map((item) => berlinParts(new Date(item.faelligAm)).key));
  const dayItems = items
    .filter((item) => berlinParts(new Date(item.faelligAm)).key === selected)
    .sort((a, b) => a.faelligAm.localeCompare(b.faelligAm));
  const weekDays = Array.from({ length: 7 }, (_, index) => addCivilDays(weekStart, index));

  async function create() {
    const text = titel.trim();
    if (!text) {
      return;
    }
    setFormError(null);
    try {
      await api("/api/calendar", {
        method: "POST",
        body: JSON.stringify({
          titel: text,
          faelligAm: due,
          ...(repeat ? { wiederholung: repeat } : {}),
        }),
      });
      setTitel("");
      setOpen(false);
      setSelected(due.slice(0, 10));
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "Termin nicht angelegt");
    }
  }

  return (
    <div data-no-swipe>
      <header className="top">
        <div>
          <p className="eyebrow">Kalender</p>
          <h1>{new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(cursor.year, cursor.month - 1, 1))}</h1>
        </div>
        <button type="button" className="text-btn" onClick={() => { setDue(`${selected}T18:00`); setOpen(true); }}>
          Neu
        </button>
      </header>
      <div className="seg" role="group" aria-label="Ansicht">
        <button type="button" aria-pressed={mode === "month"} onClick={() => setMode("month")}>Monat</button>
        <button type="button" aria-pressed={mode === "week"} onClick={() => setMode("week")}>Woche</button>
      </div>
      <div className="cal-head">
        <button type="button" className="icon-btn" aria-label="Zurück" onClick={() => shift(-1)}>‹</button>
        <button type="button" className="text-btn ghost" onClick={() => { setCursor({ year: now.year, month: now.month }); setSelected(now.key); }}>Heute</button>
        <button type="button" className="icon-btn" aria-label="Weiter" onClick={() => shift(1)}>›</button>
      </div>
      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {mode === "month" ? (
        <div className="grid" role="grid" aria-label="Monat">
          {DOW.map((label) => <span key={label} className="dow">{label}</span>)}
          {grid.map((cell) => (
            <button
              key={cell.key}
              type="button"
              className={`${cell.inMonth ? "" : "out"} ${cell.key === now.key ? "today" : ""} ${cell.key === selected ? "on" : ""}`}
              aria-pressed={cell.key === selected}
              onClick={() => setSelected(cell.key)}
            >
              {Number(cell.key.slice(8))}
              {marks.has(cell.key) ? <i className="mark" /> : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="days">
          {weekDays.map((key) => (
            <button key={key} type="button" className={key === selected ? "on" : ""} aria-pressed={key === selected} onClick={() => setSelected(key)}>
              <span className="dow">{DOW[(new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7]}</span>
              {Number(key.slice(8))}
            </button>
          ))}
        </div>
      )}
      <h2>{longDay(selected)}</h2>
      {loading ? <Skeleton lines={2} /> : null}
      {!loading && dayItems.length === 0 ? (
        <Empty title="Nichts an diesem Tag" text="Tippe auf Neu, um einen Termin zu legen." />
      ) : (
        dayItems.map((item) => (
          <article key={`${item.taskId}-${item.faelligAm}`} className="card">
            <strong>{clock(item.faelligAm)} {item.titel}</strong>
            <p>
              {repeatLabel(item.wiederholung)}
              {item.projected ? " · wiederholt" : ""}
              {item.status !== "offen" ? ` · ${item.status}` : ""}
            </p>
          </article>
        ))
      )}
      <Sheet open={open} title="Neuer Termin" onClose={() => setOpen(false)}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="field">
            <span>Titel</span>
            <input value={titel} onChange={(event) => setTitel(event.target.value)} required maxLength={200} />
          </label>
          <label className="field">
            <span>Beginn</span>
            <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} required />
          </label>
          <label className="field">
            <span>Wiederholung</span>
            <select value={repeat} onChange={(event) => setRepeat(event.target.value)}>
              <option value="">einmal</option>
              <option value="taeglich">täglich</option>
              <option value="woechentlich">wöchentlich</option>
            </select>
          </label>
          {formError ? <p role="alert">{formError}</p> : null}
          <button type="submit" className="text-btn">Anlegen</button>
        </form>
      </Sheet>
    </div>
  );

  function shift(delta: number) {
    if (mode === "week") {
      const next = addCivilDays(selected, delta * 7);
      const [year, month] = next.split("-").map(Number);
      setSelected(next);
      setCursor({ year: year ?? now.year, month: month ?? now.month });
      return;
    }
    const date = new Date(Date.UTC(cursor.year, cursor.month - 1 + delta, 1));
    setCursor({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  }
}
