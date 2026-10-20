import { lazy, Suspense, useEffect, useState } from "react";
import { berlinParts } from "@jarvis/dates.ts";
import { resolveOrbState } from "@jarvis/orb-state.ts";
import type { WidgetItem } from "../../../src/settings/model.ts";
import { api } from "../api.ts";
import { getLocale, useI18n } from "../i18n/index.ts";
import { Orb } from "../orb/Orb.tsx";
import type { ChatMessage, Note, StatusResponse, Task } from "../types.ts";
import { Empty, Sheet, Skeleton } from "../ui.tsx";

const Board = lazy(() => import("../widgets/Board.tsx").then((mod) => ({ default: mod.Board })));

function greeting(date: Date, tr: (key: string) => string): string {
  const hour = berlinParts(date).hour;
  if (hour < 5 || hour >= 22) return tr("greet.night");
  if (hour < 11) return tr("greet.morning");
  if (hour < 18) return tr("greet.day");
  return tr("greet.evening");
}

export function Dashboard({
  status,
  tasks,
  notes,
  messages,
  loading,
  error,
  connection,
  widgets,
  editing,
  onEditing,
  onWidgets,
  onOpen,
  onRefresh,
  onCloseNote,
  onCreate,
  onSettings,
  onMemory,
  mistakeStamp,
}: {
  status: StatusResponse | null;
  tasks: Task[];
  notes: Note[];
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  connection: "offline" | "connecting" | "connected";
  widgets: WidgetItem[];
  editing: boolean;
  onEditing: (value: boolean) => void;
  onWidgets: (items: WidgetItem[]) => void;
  onOpen: (page: number) => void;
  onRefresh: () => void;
  onCloseNote: (id: string) => void;
  onCreate: (input: { titel: string }) => Promise<void>;
  onSettings: () => void;
  onMemory: () => void;
  mistakeStamp: number;
}) {
  const t = useI18n();
  const [notesOpen, setNotesOpen] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [clock, setClock] = useState(() => new Date());
  const [speakTick, setSpeakTick] = useState(0);
  const link = connection === "connected" ? t("dash.live") : connection === "connecting" ? t("dash.connecting") : t("dash.offline");
  const orb = resolveOrbState({ messages, now: Date.now() });
  const parts = berlinParts(clock);
  const dateLabel = new Intl.DateTimeFormat(getLocale() === "en" ? "en-GB" : "de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(clock);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (orb !== "speaking") {
      return;
    }
    const id = window.setTimeout(() => setSpeakTick((value) => value + 1), 400);
    return () => window.clearTimeout(id);
  }, [orb, speakTick, messages]);

  useEffect(() => {
    let gone = false;
    void api<{ correctionsThisMonth: number }>("/api/memory")
      .then((body) => {
        if (!gone) {
          setMistakes(body.correctionsThisMonth);
        }
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [mistakeStamp]);

  return (
    <div className="stack">
      <header className="dash-head">
        <div className="dash-greet">
          <h1>{greeting(clock, t)}, Levin</h1>
          <p className="dash-date">
            {dateLabel}
            <span className="dash-time">
              {String(parts.hour).padStart(2, "0")}:{String(parts.minute).padStart(2, "0")}
            </span>
          </p>
          <p className="dash-date">{t("dash.mistakes", { count: mistakes })}</p>
        </div>
        <Orb state={orb} />
        <div className="dash-tools">
          {editing ? (
            <button type="button" className="text-btn" onClick={() => onEditing(false)}>
              {t("widget.editDone")}
            </button>
          ) : (
            <button type="button" className="icon-btn" onClick={onSettings} aria-label={t("dash.settings")}>
              <Gear />
            </button>
          )}
          <button type="button" className="pill" onClick={onRefresh} aria-label={t("common.refresh")}>
            <span className={`dot ${connection === "connected" ? "ok" : connection === "connecting" ? "warn" : "bad"}`} />
            {link}
          </button>
        </div>
      </header>
      {error ? (
        <div className="banner bad" role="alert">
          <span>{error}</span>
          <button type="button" className="text-btn ghost" onClick={onRefresh}>{t("common.retry")}</button>
        </div>
      ) : null}
      {loading && !status ? <Skeleton lines={5} /> : (
        <Suspense fallback={<Skeleton lines={5} />}>
          <Board
            items={widgets}
            editing={editing}
            onEditing={onEditing}
            onChange={onWidgets}
            onOpen={onOpen}
            onCreate={onCreate}
            onMemory={onMemory}
            status={status}
            tasks={tasks}
            notes={notes}
            messages={messages}
          />
        </Suspense>
      )}
      <button type="button" className="text-btn ghost" onClick={() => setNotesOpen(true)}>
        {t("notes.title")}
      </button>
      <Sheet open={notesOpen} title={t("notes.title")} onClose={() => setNotesOpen(false)}>
        {notes.length === 0 ? (
          <Empty title={t("notes.emptyTitle")} text={t("notes.emptyBody")} />
        ) : (
          notes.map((note) => (
            <div key={note.id} className="row" data-no-swipe>
              <div className="body">
                <h3>{note.person ?? t("notes.person")}</h3>
                <p className="muted">{note.text}</p>
              </div>
              <button type="button" className="text-btn ghost" onClick={() => onCloseNote(note.id)}>
                {t("common.close")}
              </button>
            </div>
          ))
        )}
      </Sheet>
    </div>
  );
}

function Gear() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
