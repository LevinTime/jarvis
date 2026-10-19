import { lazy, Suspense, useRef, useState } from "react";
import { berlinParts } from "@jarvis/dates.ts";
import { swipeAxis } from "@jarvis/gesture.ts";
import type { WidgetItem } from "../../../src/settings/model.ts";
import { useI18n } from "../i18n/index.ts";
import type { ChatMessage, Note, StatusResponse, Task } from "../types.ts";
import { Empty, Lamp, Sheet, Skeleton } from "../ui.tsx";

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
  onUsage,
  onRefresh,
  onCloseNote,
  onCreate,
  onSettings,
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
  onUsage: () => void;
  onRefresh: () => void;
  onCloseNote: (id: string) => void;
  onCreate: (input: { titel: string }) => Promise<void>;
  onSettings: () => void;
}) {
  const t = useI18n();
  const [notesOpen, setNotesOpen] = useState(false);
  const pull = useRef<{ x: number; y: number } | null>(null);
  const budget = status?.usage?.budget;
  const link = connection === "connected" ? t("dash.live") : connection === "connecting" ? t("dash.connecting") : t("dash.offline");

  return (
    <div className="stack">
      <header className="top">
        <div className="brand">
          <Lamp className="lg" />
          <div>
            <p className="eyebrow">Jarvis</p>
            <h1>{greeting(new Date(), t)}, Levin</h1>
            <p
              className="hint"
              data-no-swipe
              onPointerDown={(event) => {
                pull.current = { x: event.clientX, y: event.clientY };
              }}
              onPointerUp={(event) => {
                if (!pull.current) return;
                const dx = event.clientX - pull.current.x;
                const dy = event.clientY - pull.current.y;
                pull.current = null;
                if (swipeAxis(dx, dy) === "y" && dy > 0) onUsage();
              }}
            >
              {t("dash.costHint")}
            </p>
          </div>
        </div>
        <div className="stack">
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
      {budget && (budget.level === "warn" || budget.level === "over") ? (
        <div className={`banner ${budget.level === "over" ? "bad" : "warn"}`}>
          <span>{budget.level === "over" ? t("dash.over") : t("dash.warn")}</span>
          <button type="button" className="text-btn ghost" onClick={onUsage}>{t("dash.cost")}</button>
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
            onUsage={onUsage}
            onCreate={onCreate}
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
