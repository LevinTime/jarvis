import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { addCivilDays, berlinParts, mondayOf } from "@jarvis/dates.ts";
import { isOrbState, resolveOrbState, type OrbState } from "@jarvis/orb-state.ts";
import { Mic } from "lucide-react";
import type { WidgetItem } from "../../../src/settings/model.ts";
import { api } from "../api.ts";
import { clock, longDay } from "../format.ts";
import { getLocale, useI18n } from "../i18n/index.ts";
import { Orb } from "../orb/Orb.tsx";
import type { ChatMessage, Note, StatusResponse, Task, TaskStatus } from "../types.ts";
import { Empty, Sheet, Skeleton } from "../ui.tsx";

const Board = lazy(() => import("../widgets/Board.tsx").then((mod) => ({ default: mod.Board })));
const PREVIEW = 5;

function greeting(date: Date, tr: (key: string) => string): string {
  const hour = berlinParts(date).hour;
  if (hour < 5 || hour >= 22) return tr("greet.night");
  if (hour < 11) return tr("greet.morning");
  if (hour < 18) return tr("greet.day");
  return tr("greet.evening");
}

function weekdayShort(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12));
  return new Intl.DateTimeFormat(getLocale() === "en" ? "en-GB" : "de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
  }).format(date).replace(/\.$/, "");
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
  resetKey,
  onResetLayout,
  onWidgets,
  onOpen,
  onRefresh,
  onCloseNote,
  onCreate,
  onPatch,
  onSend,
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
  resetKey: number;
  onResetLayout: () => void;
  onWidgets: (items: WidgetItem[]) => void;
  onOpen: (page: number) => void;
  onRefresh: () => void;
  onCloseNote: (id: string) => void;
  onCreate: (input: { titel: string }) => Promise<void>;
  onPatch: (id: string, patch: { status?: TaskStatus }) => Promise<void>;
  onSend: (text: string) => Promise<void>;
  onSettings: () => void;
  onMemory: () => void;
  mistakeStamp: number;
}) {
  const t = useI18n();
  const askRef = useRef<HTMLTextAreaElement>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [speakTick, setSpeakTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const link = connection === "connected" ? t("dash.live") : connection === "connecting" ? t("dash.connecting") : t("dash.offline");
  const requested = new URLSearchParams(window.location.search).get("orb");
  const forced: OrbState | null = isOrbState(requested) ? requested : null;
  const orb = forced ?? resolveOrbState({
    messages,
    now: Date.now(),
    failed: Boolean(error) || connection === "offline",
  });
  const parts = berlinParts(clockNow);
  const today = parts.key;
  const dateLabel = new Intl.DateTimeFormat(getLocale() === "en" ? "en-GB" : "de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(clockNow);
  const open = tasks.filter((task) => task.status !== "erledigt");
  const appointments = open
    .filter((task) => task.faelligAm && berlinParts(new Date(task.faelligAm)).key === today)
    .sort((a, b) => (a.faelligAm ?? "").localeCompare(b.faelligAm ?? ""));
  const appointmentIds = new Set(appointments.map((task) => task.id));
  const checklist = open
    .filter((task) => !appointmentIds.has(task.id))
    .sort((a, b) => (a.faelligAm ?? "9999").localeCompare(b.faelligAm ?? "9999"));
  const marked = new Set(
    open
      .filter((task) => task.faelligAm)
      .map((task) => berlinParts(new Date(task.faelligAm ?? "")).key),
  );
  const week = Array.from({ length: 7 }, (_, index) => addCivilDays(mondayOf(today), index));

  useEffect(() => {
    const id = window.setInterval(() => setClockNow(new Date()), 30_000);
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

  async function complete(id: string) {
    setPendingId(id);
    try {
      await onPatch(id, { status: "erledigt" });
      setActionError(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t("tasks.failSave"));
    } finally {
      setPendingId(null);
    }
  }

  async function ask(event: { preventDefault(): void }) {
    event.preventDefault();
    const value = draft.trim();
    if (!value) {
      askRef.current?.focus();
      return;
    }
    setDraft("");
    if (askRef.current) {
      askRef.current.style.height = "auto";
    }
    await onSend(value);
  }

  return (
    <div className="stack stage">
      <header className="stage-top">
        <div className="dash-greet">
          <h1>{greeting(clockNow, t)}, Levin</h1>
          <p className="dash-date">{dateLabel}</p>
        </div>
        <button type="button" className="monogram" onClick={onSettings} aria-label={t("dash.settings")}>
          L
        </button>
      </header>
      <ul className="week" aria-label={t("home.week")}>
        {week.map((key) => (
          <li key={key}>
            <button
              type="button"
              aria-current={key === today ? "date" : undefined}
              aria-label={longDay(key)}
              onClick={() => onOpen(0)}
            >
              <span>{weekdayShort(key)}</span>
              <span className="week-num">{Number(key.slice(-2))}</span>
              <span className={`week-dot${marked.has(key) ? " on" : ""}`} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {error || actionError ? (
        <div className="banner bad" role="alert">
          <span>{error ?? actionError}</span>
          <button type="button" className="text-btn ghost" onClick={onRefresh}>{t("common.retry")}</button>
        </div>
      ) : null}
      {editing ? (
        <div className="stage-tools">
          <button type="button" className="text-btn" onClick={() => onEditing(false)}>
            {t("widget.editDone")}
          </button>
          <button type="button" className="text-btn ghost" onClick={onResetLayout}>
            {t("common.reset")}
          </button>
        </div>
      ) : null}
      <div className="stage-scroll">
      {loading && !status ? <Skeleton lines={5} /> : editing ? (
        <Suspense fallback={<Skeleton lines={5} />}>
          <Board
            items={widgets}
            editing={editing}
            resetKey={resetKey}
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
      ) : (
        <>
          <div className="stage-body">
            <div className="stage-hero">
              <Orb state={orb} hero />
              {orb === "idle" ? <p className="stage-invite">{t("home.help")}</p> : null}
            </div>
            <section className="stage-card stage-events" aria-labelledby="home-events">
              <header>
                <h2 id="home-events">{t("tasks.today")}</h2>
                <span className="muted">
                  {appointments.length === 1
                    ? t("home.appointment", { count: appointments.length })
                    : t("home.appointments", { count: appointments.length })}
                </span>
              </header>
              {appointments.length === 0 ? <p className="muted">{t("widget.noEvents")}</p> : (
                <ul className="stage-list">
                  {appointments.slice(0, PREVIEW).map((task) => (
                    <li key={task.id}>
                      <button type="button" className="appt" onClick={() => onOpen(0)}>
                        <span className="appt-time">{task.faelligAm ? clock(task.faelligAm) : t("tasks.noDate")}</span>
                        <span>{task.titel}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {appointments.length > PREVIEW ? (
                <button type="button" className="text-btn ghost stage-more" onClick={() => onOpen(0)}>
                  {t("widget.more", { count: appointments.length - PREVIEW })}
                </button>
              ) : null}
            </section>
            <section className="stage-card stage-tasks" aria-labelledby="home-tasks">
              <header>
                <h2 id="home-tasks">{t("nav.tasks")}</h2>
                <span className="stage-status">
                  <span className={`dot ${connection === "connected" ? "ok" : connection === "connecting" ? "warn" : "bad"}`} />
                  {link}
                </span>
              </header>
              {checklist.length === 0 ? <p className="muted">{t("tasks.emptyTitle")}</p> : (
                <ul className="stage-list">
                  {checklist.slice(0, PREVIEW).map((task) => (
                    <li key={task.id} className="task-line">
                      <button
                        type="button"
                        className="check"
                        aria-label={t("tasks.complete")}
                        disabled={pendingId === task.id}
                        onClick={() => void complete(task.id)}
                      />
                      <button type="button" className="task-name" onClick={() => onOpen(2)}>
                        {task.titel}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {checklist.length > PREVIEW ? (
                <button type="button" className="text-btn ghost stage-more" onClick={() => onOpen(2)}>
                  {t("widget.more", { count: checklist.length - PREVIEW })}
                </button>
              ) : null}
              <p className="muted">{t("widget.openCount", { count: checklist.length })}</p>
            </section>
          </div>
          <div className="stage-tools stage-links">
            <button type="button" className="text-btn ghost" onClick={() => onEditing(true)}>
              {t("dash.arrange")}
            </button>
            <button type="button" className="text-btn ghost" onClick={() => setNotesOpen(true)}>
              {t("notes.title")}
            </button>
            <button type="button" className="text-btn ghost" onClick={onMemory}>
              {t("widget.memory")}
            </button>
          </div>
          {mistakes > 0 ? <p className="muted stage-note">{t("dash.mistakes", { count: mistakes })}</p> : null}
        </>
      )}
      </div>
      {editing || (loading && !status) ? null : (
          <form className="composer home-composer" data-no-swipe onSubmit={(event) => void ask(event)}>
            <label className="sr-only" htmlFor="home-ask">{t("chat.message")}</label>
            <textarea
              id="home-ask"
              ref={askRef}
              rows={1}
              value={draft}
              maxLength={4000}
              placeholder={t("home.ask")}
              enterKeyHint="send"
              onChange={(event) => {
                setDraft(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 136)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) {
                  return;
                }
                if (window.matchMedia("(pointer: coarse)").matches) {
                  return;
                }
                event.preventDefault();
                void ask(event);
              }}
            />
            <button type="submit" className="mic" aria-label={draft.trim() ? t("chat.send") : t("home.write")}>
              <Mic size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </form>
      )}
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
