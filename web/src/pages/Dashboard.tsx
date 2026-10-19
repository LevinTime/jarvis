import { useRef, useState } from "react";
import { bucketTask, greeting } from "@jarvis/dates.ts";
import { berlinParts } from "@jarvis/dates.ts";
import { swipeAxis } from "@jarvis/gesture.ts";
import { clock } from "../format.ts";
import type { ChatMessage, Note, StatusResponse, Task } from "../types.ts";
import { Empty, Lamp, Sheet, Skeleton } from "../ui.tsx";

function level(ok: boolean, warn: boolean): "ok" | "warn" | "bad" {
  if (!ok) {
    return "bad";
  }
  return warn ? "warn" : "ok";
}

export function Dashboard({
  status,
  tasks,
  notes,
  messages,
  loading,
  error,
  connection,
  themeLabel,
  onOpen,
  onUsage,
  onRefresh,
  onCloseNote,
  onTheme,
}: {
  status: StatusResponse | null;
  tasks: Task[];
  notes: Note[];
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  connection: "offline" | "connecting" | "connected";
  themeLabel: string;
  onOpen: (page: number) => void;
  onUsage: () => void;
  onRefresh: () => void;
  onCloseNote: (id: string) => void;
  onTheme: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const pull = useRef<{ x: number; y: number } | null>(null);
  const today = berlinParts(new Date()).key;
  const overdue = tasks.filter((task) => bucketTask(task, today) === "overdue").length;
  const dueToday = tasks.filter((task) => bucketTask(task, today) === "today").length;
  const upcoming = tasks
    .filter((task) => task.status === "offen" && task.faelligAm && berlinParts(new Date(task.faelligAm)).key >= today)
    .sort((a, b) => (a.faelligAm ?? "").localeCompare(b.faelligAm ?? ""))
    .slice(0, 3);
  const last = messages.at(-1);
  const budget = status?.usage?.budget;
  const ratio = budget?.ratio ?? 0;
  const link = connection === "connected" ? "live" : connection === "connecting" ? "verbinde" : "offline";

  return (
    <div className="stack">
      <header className="top">
        <div className="brand">
          <Lamp className="lg" />
          <div>
            <p className="eyebrow">Jarvis</p>
            <h1>
              {greeting(new Date())}, Levin
            </h1>
            <p
              className="hint"
              data-no-swipe
              onPointerDown={(event) => {
                pull.current = { x: event.clientX, y: event.clientY };
              }}
              onPointerUp={(event) => {
                if (!pull.current) {
                  return;
                }
                const dx = event.clientX - pull.current.x;
                const dy = event.clientY - pull.current.y;
                pull.current = null;
                if (swipeAxis(dx, dy) === "y" && dy > 0) {
                  onUsage();
                }
              }}
            >
              nach unten für die Kosten
            </p>
          </div>
        </div>
        <div className="stack">
          <button type="button" className="icon-btn" onClick={onTheme} aria-label={themeLabel}>
            {themeLabel}
          </button>
          <button type="button" className="pill" onClick={onRefresh} aria-label="Aktualisieren">
            <span className={`dot ${connection === "connected" ? "ok" : connection === "connecting" ? "warn" : "bad"}`} />
            {link}
          </button>
        </div>
      </header>

      {error ? (
        <div className="banner bad" role="alert">
          <span>{error}</span>
          <button type="button" className="text-btn ghost" onClick={onRefresh}>
            Nochmal
          </button>
        </div>
      ) : null}
      {budget && (budget.level === "warn" || budget.level === "over") ? (
        <div className={`banner ${budget.level === "over" ? "bad" : "warn"}`}>
          <span>
            {budget.level === "over"
              ? "Monatsbudget aufgebraucht. Jarvis antwortet weiter, die Kosten laufen darüber hinaus."
              : "80 % des Monatsbudgets sind erreicht. Jarvis antwortet weiter."}
          </span>
          <button type="button" className="text-btn ghost" onClick={onUsage}>
            Kosten
          </button>
        </div>
      ) : null}

      {loading && !status ? <Skeleton lines={5} /> : null}

      <section className="card">
        <span className="kicker">System</span>
        <div className="lights">
          <div className="light">
            <span className={`dot ${level(Boolean(status?.telegram.connected), Boolean(status?.telegram.configured && !status.telegram.connected))}`} />
            Bot
          </div>
          <div className="light">
            <span className={`dot ${level(Boolean(status?.llm.configured && !status.llm.lastError), Boolean(status?.llm.configured && status.llm.lastError))}`} />
            Sprachmodell
          </div>
          <div className="light">
            <span className={`dot ${level(Boolean(status?.telegram.mirror), Boolean(status?.telegram.configured && !status.telegram.mirror))}`} />
            Spiegelung
          </div>
        </div>
        {status?.telegram.warning ? <p>{status.telegram.warning}</p> : null}
        {status?.llm.lastError ? <p>{status.llm.lastError}</p> : null}
      </section>

      <button type="button" className="card" onClick={() => onOpen(2)}>
        <span className="kicker">Aufgaben</span>
        <strong>
          {dueToday} heute{overdue > 0 ? ` · ${overdue} überfällig` : ""}
        </strong>
        <p>{tasks.filter((task) => task.status !== "erledigt").length} offen</p>
      </button>

      <button type="button" className="card" onClick={() => onOpen(0)}>
        <span className="kicker">Als Nächstes</span>
        {upcoming.length === 0 ? (
          <p>Keine kommenden Termine.</p>
        ) : (
          upcoming.map((task) => (
            <p key={task.id}>
              {task.faelligAm ? clock(task.faelligAm) : ""} {task.titel}
            </p>
          ))
        )}
      </button>

      <button type="button" className="card" onClick={onUsage}>
        <span className="kicker">Kosten</span>
        <strong>
          {status?.usage ? `${status.usage.todayUsd.toFixed(2)} $ heute` : "noch keine Zahlen"}
        </strong>
        {budget && budget.limitUsd ? (
          <div
            className="meter"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(1, ratio) * 100)}
            aria-label="Monatsbudget"
          >
            <span data-level={budget.level} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
        ) : (
          <p>Monat {status?.usage ? `${status.usage.monthUsd.toFixed(2)} $` : "–"}</p>
        )}
      </button>

      <button type="button" className="card" onClick={() => onOpen(3)}>
        <span className="kicker">Chat</span>
        {last ? <p>{last.text.slice(0, 140)}</p> : <p>Noch keine Nachricht.</p>}
      </button>

      <button type="button" className="card" onClick={() => setNotesOpen(true)}>
        <span className="kicker">Notizen</span>
        <strong>{notes.length} offen</strong>
      </button>

      <Sheet open={notesOpen} title="Offene Notizen" onClose={() => setNotesOpen(false)}>
        {notes.length === 0 ? (
          <Empty title="Nichts offen" text="Wenn Jarvis sich etwas merkt, liegt es hier." />
        ) : (
          notes.map((note) => (
            <div key={note.id} className="row" data-no-swipe>
              <div className="body">
                <h3>{note.person ?? "Notiz"}</h3>
                <p className="muted">{note.text}</p>
              </div>
              <button type="button" className="text-btn ghost" onClick={() => onCloseNote(note.id)}>
                Schließen
              </button>
            </div>
          ))
        )}
      </Sheet>
    </div>
  );
}
