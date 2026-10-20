import { useEffect, useRef, useState } from "react";
import { ResponsiveGridLayout, useContainerWidth } from "react-grid-layout";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./board.css";
import { berlinParts, bucketTask } from "@jarvis/dates.ts";
import {
  BREAKPOINTS,
  COLS,
  LAYOUT_STORAGE_KEY,
  layoutsEqual,
  mergeLayouts,
  nearestSize,
  packLayouts,
  readDashboardLayouts,
  serializeDashboardLayouts,
  spanFor,
  type BreakpointId,
  type DashboardLayouts,
  type TileLayout,
} from "@jarvis/dashboard-layout.ts";
import { minutesInBerlin, type DayEvent } from "@jarvis/day-timeline.ts";
import { WIDGET_KINDS, type WidgetItem, type WidgetKind } from "../../../src/settings/model.ts";
import { api } from "../api.ts";
import { clock } from "../format.ts";
import { useI18n } from "../i18n/index.ts";
import type { ChatMessage, Note, StatusResponse, Task } from "../types.ts";
import { pulse } from "../ui.tsx";
import { DayBar } from "./DayBar.tsx";

const HIDDEN_KINDS = new Set<WidgetKind>(["cost", "clock"]);

function readStoredLayout(): string | null {
  try {
    return localStorage.getItem(LAYOUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLayout(layouts: DashboardLayouts): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, serializeDashboardLayouts(layouts));
  } catch {
    /* private mode */
  }
}

function toTiles(layout: Layout): TileLayout[] {
  return layout.map((item) => ({ i: item.i, x: item.x, y: item.y, w: item.w, h: item.h }));
}

export function Board({
  items,
  editing,
  resetKey,
  onChange,
  onOpen,
  onCreate,
  onMemory,
  status,
  tasks,
  notes,
  messages,
}: {
  items: WidgetItem[];
  editing: boolean;
  resetKey: number;
  onChange: (items: WidgetItem[]) => void;
  onOpen: (page: number) => void;
  onCreate: (input: { titel: string }) => Promise<void>;
  onMemory: () => void;
  status: StatusResponse | null;
  tasks: Task[];
  notes: Note[];
  messages: ChatMessage[];
}) {
  const t = useI18n();
  const [adding, setAdding] = useState(false);
  const [breakpoint, setBreakpoint] = useState<BreakpointId>("sm");
  const shown = items.filter((item) => !HIDDEN_KINDS.has(item.kind));
  const ids = shown.map((item) => item.id);
  const idsKey = ids.join("|");
  const [layouts, setLayouts] = useState(() => readDashboardLayouts(readStoredLayout(), ids));
  const seenReset = useRef(resetKey);
  const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });
  const missing = WIDGET_KINDS.filter((kind) => !HIDDEN_KINDS.has(kind) && !shown.some((item) => item.kind === kind));

  useEffect(() => {
    document.documentElement.dataset.editing = editing ? "1" : "0";
    return () => {
      delete document.documentElement.dataset.editing;
    };
  }, [editing]);

  useEffect(() => {
    const nextIds = idsKey.length === 0 ? [] : idsKey.split("|");
    setLayouts((current) => {
      const merged = mergeLayouts(current, nextIds);
      return layoutsEqual(current, merged) ? current : merged;
    });
  }, [idsKey]);

  useEffect(() => {
    if (seenReset.current === resetKey) {
      return;
    }
    seenReset.current = resetKey;
    const nextIds = idsKey.length === 0 ? [] : idsKey.split("|");
    const next = packLayouts(nextIds);
    setLayouts(next);
    writeStoredLayout(next);
  }, [resetKey, idsKey]);

  function save(breakpointId: BreakpointId, layout: Layout) {
    setLayouts((current) => {
      const next = { ...current, [breakpointId]: toTiles(layout) };
      writeStoredLayout(next);
      return next;
    });
    pulse(8);
  }

  return (
    <div>
      <div ref={containerRef} className="bento">
        {mounted && width > 0 ? (
          <ResponsiveGridLayout
            width={width}
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={40}
            margin={[12, 12]}
            containerPadding={[0, 0]}
            dragConfig={{ enabled: editing, handle: ".widget-handle", threshold: 4 }}
            resizeConfig={{ enabled: editing, handles: ["se"] }}
            onBreakpointChange={(next) => {
              if (next === "lg" || next === "md" || next === "sm") {
                setBreakpoint(next);
              }
            }}
            onDragStop={(layout) => save(breakpoint, layout)}
            onResizeStop={(layout, _previous, item) => {
              if (!item) {
                save(breakpoint, layout);
                return;
              }
              const cols = COLS[breakpoint];
              const size = nearestSize(item.w, item.h, item.i, cols);
              const span = spanFor(item.i, size, cols);
              save(
                breakpoint,
                layout.map((tile) => (tile.i === item.i ? { ...tile, w: span.w, h: span.h } : tile)),
              );
              onChange(items.map((entry) => (entry.id === item.i ? { ...entry, size } : entry)));
            }}
          >
            {shown.map((item) => (
              <article key={item.id} className="widget" data-size={item.size}>
                {editing ? (
                  <div className="tools">
                    <button type="button" className="widget-handle" aria-label={t("widget.handle")}>
                      ⠿
                    </button>
                    <button
                      type="button"
                      aria-label={t("widget.remove")}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => onChange(items.filter((entry) => entry.id !== item.id))}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                <WidgetBody
                  item={item}
                  status={status}
                  tasks={tasks}
                  notes={notes}
                  messages={messages}
                  onOpen={onOpen}
                  onCreate={onCreate}
                  onMemory={onMemory}
                  locked={editing}
                />
              </article>
            ))}
          </ResponsiveGridLayout>
        ) : null}
      </div>
      {editing ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <button type="button" className="text-btn" onClick={() => setAdding((open) => !open)} aria-label={t("widget.add")}>
            +
          </button>
          {adding ? (
            <div className="choice">
              {missing.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="text-btn ghost"
                  onClick={() => {
                    onChange([...items, { id: kind, kind, size: kind === "quick" || kind === "notes" || kind === "cost" || kind === "chat" || kind === "memory" ? "s" : "m" }]);
                    setAdding(false);
                  }}
                >
                  {label(kind, t)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function label(kind: WidgetKind, tr: (key: string) => string): string {
  switch (kind) {
    case "clock": return tr("widget.clock");
    case "status": return tr("widget.status");
    case "tasks": return tr("widget.tasks");
    case "events": return tr("widget.events");
    case "cost": return tr("widget.cost");
    case "chat": return tr("widget.chat");
    case "notes": return tr("widget.notes");
    case "quick": return tr("widget.quick");
    case "t3": return tr("widget.t3");
    case "memory": return tr("widget.memory");
  }
}

function WidgetBody({
  item,
  status,
  tasks,
  notes,
  messages,
  onOpen,
  onCreate,
  onMemory,
  locked,
}: {
  item: WidgetItem;
  status: StatusResponse | null;
  tasks: Task[];
  notes: Note[];
  messages: ChatMessage[];
  onOpen: (page: number) => void;
  onCreate: (input: { titel: string }) => Promise<void>;
  onMemory: () => void;
  locked: boolean;
}) {
  const t = useI18n();
  const today = berlinParts(new Date()).key;
  const openTask = (page: number) => {
    if (!locked) {
      onOpen(page);
    }
  };
  if (item.kind === "clock") {
    return <Clock />;
  }
  if (item.kind === "status") {
    const bot = status?.telegram.connected ? "ok" : status?.telegram.configured ? "warn" : "bad";
    const model = status?.llm.configured && !status.llm.lastError ? "ok" : status?.llm.lastError ? "warn" : "bad";
    const mirror = status?.telegram.mirror ? "ok" : status?.telegram.configured ? "warn" : "bad";
    return (
      <div className="chip-row" aria-label={t("widget.status")}>
        <span className="chip"><span className={`dot ${bot}`} />{t("widget.bot")}</span>
        <span className="chip"><span className={`dot ${model}`} />{t("widget.model")}</span>
        <span className="chip"><span className={`dot ${mirror}`} />{t("widget.mirror")}</span>
      </div>
    );
  }
  if (item.kind === "tasks") {
    const due = tasks.filter((task) => bucketTask(task, today) === "today").length;
    const open = tasks.filter((task) => task.status !== "erledigt");
    const appointments = open.filter((task) => task.faelligAm && berlinParts(new Date(task.faelligAm)).key === today).length;
    const upcoming = open
      .slice()
      .sort((a, b) => (a.faelligAm ?? "9999").localeCompare(b.faelligAm ?? "9999"));
    const preview = upcoming.slice(0, 5);
    const extra = upcoming.length - preview.length;
    return (
      <button type="button" className="tile-hit" onClick={() => openTask(2)}>
        <p className="stat-line">
          {t("widget.due", { count: due })} · {t("widget.openCount", { count: open.length })} · {t("widget.eventCount", { count: appointments })}
        </p>
        <ul className="mini-list">
          {preview.map((task) => (
            <li key={task.id}>
              <span className="mini-time">{task.faelligAm ? clock(task.faelligAm) : t("tasks.noDate")}</span>
              <span>{task.titel}</span>
            </li>
          ))}
        </ul>
        {extra > 0 ? <p className="mini-more">{t("widget.more", { count: extra })}</p> : null}
      </button>
    );
  }
  if (item.kind === "events") {
    const events: DayEvent[] = tasks
      .filter((task) => task.status !== "erledigt" && task.faelligAm && berlinParts(new Date(task.faelligAm)).key === today)
      .map((task) => ({
        id: task.id,
        title: task.titel,
        startMin: minutesInBerlin(new Date(task.faelligAm ?? "")),
      }));
    return (
      <button type="button" className="tile-hit" onClick={() => openTask(0)}>
        <span className="kicker">{t("widget.events")}</span>
        {events.length === 0 ? <p className="day-next">{t("widget.noEvents")}</p> : <DayBar events={events} now={new Date()} />}
      </button>
    );
  }
  if (item.kind === "cost") {
    return null;
  }
  if (item.kind === "chat") {
    const last = messages.at(-1);
    return (
      <button type="button" className="row body" onClick={() => openTask(3)}>
        <span className="kicker">{t("widget.chat")}</span>
        <p>{last ? last.text.slice(0, 140) : t("widget.noChat")}</p>
      </button>
    );
  }
  if (item.kind === "notes") {
    return (
      <div>
        <span className="kicker">{t("widget.notes")}</span>
        <h3>{t("widget.notesCount", { count: notes.length })}</h3>
        <p className="muted">{notes[0]?.text.slice(0, 80) ?? t("widget.noNotes")}</p>
      </div>
    );
  }
  if (item.kind === "quick") {
    return <QuickAdd locked={locked} onCreate={onCreate} />;
  }
  if (item.kind === "memory") {
    return (
      <button type="button" className="row body" onClick={() => { if (!locked) onMemory(); }}>
        <span className="kicker">{t("widget.memory")}</span>
        <p>{t("widget.memoryEmpty")}</p>
      </button>
    );
  }
  return <T3Status onOpen={() => openTask(4)} />;
}

function Clock() {
  const t = useI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const parts = berlinParts(now);
  const greet = parts.hour < 5 || parts.hour >= 22
    ? t("greet.night")
    : parts.hour < 11
      ? t("greet.morning")
      : parts.hour < 18
        ? t("greet.day")
        : t("greet.evening");
  return (
    <div>
      <span className="kicker">{greet}</span>
      <div className="clock-time">{String(parts.hour).padStart(2, "0")}:{String(parts.minute).padStart(2, "0")}</div>

    </div>
  );
}

function QuickAdd({ locked, onCreate }: { locked: boolean; onCreate: (input: { titel: string }) => Promise<void> }) {
  const t = useI18n();
  const [titel, setTitel] = useState("");
  return (
    <form
      data-no-swipe
      onSubmit={(event) => {
        event.preventDefault();
        const text = titel.trim();
        if (!text || locked) {
          return;
        }
        setTitel("");
        pulse();
        void onCreate({ titel: text });
      }}
    >
      <label className="field">
        <span>{t("widget.quick")}</span>
        <input value={titel} placeholder={t("widget.quickPh")} maxLength={200} onChange={(event) => setTitel(event.target.value)} />
      </label>
    </form>
  );
}

function T3Status({ onOpen }: { onOpen: () => void }) {
  const t = useI18n();
  const [up, setUp] = useState<boolean | null>(null);
  useEffect(() => {
    let gone = false;
    api<{ reachable: boolean }>("/api/t3")
      .then((body) => {
        if (!gone) {
          setUp(body.reachable);
        }
      })
      .catch(() => {
        if (!gone) {
          setUp(false);
        }
      });
    return () => {
      gone = true;
    };
  }, []);
  return (
    <button type="button" className="row body" onClick={onOpen}>
      <span className="kicker">{t("widget.t3")}</span>
      <h3>{up === null ? "…" : up ? t("widget.t3up") : t("widget.t3down")}</h3>
      <p className="muted">{t("widget.t3hint")}</p>
    </button>
  );
}
