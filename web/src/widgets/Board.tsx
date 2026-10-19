import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { berlinParts, bucketTask } from "@jarvis/dates.ts";
import { DEFAULT_WIDGETS, WIDGET_KINDS, type WidgetItem, type WidgetKind, type WidgetSize } from "../../../src/settings/model.ts";
import { api } from "../api.ts";
import { clock, usd } from "../format.ts";
import { useI18n } from "../i18n/index.ts";
import type { ChatMessage, Note, StatusResponse, Task } from "../types.ts";
import { pulse } from "../ui.tsx";

const NEXT_SIZE: Record<WidgetSize, WidgetSize> = { s: "m", m: "l", l: "s" };

export function Board({
  items,
  editing,
  onEditing,
  onChange,
  onOpen,
  onUsage,
  onCreate,
  status,
  tasks,
  notes,
  messages,
}: {
  items: WidgetItem[];
  editing: boolean;
  onEditing: (value: boolean) => void;
  onChange: (items: WidgetItem[]) => void;
  onOpen: (page: number) => void;
  onUsage: () => void;
  onCreate: (input: { titel: string }) => Promise<void>;
  status: StatusResponse | null;
  tasks: Task[];
  notes: Note[];
  messages: ChatMessage[];
}) {
  const t = useI18n();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 140, tolerance: 8 } }),
  );
  const hold = useRef<number | null>(null);
  const [adding, setAdding] = useState(false);
  const missing = WIDGET_KINDS.filter((kind) => !items.some((item) => item.kind === kind));

  useEffect(() => {
    document.documentElement.dataset.editing = editing ? "1" : "0";
    return () => {
      delete document.documentElement.dataset.editing;
    };
  }, [editing]);

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) {
      return;
    }
    onChange(arrayMove(items, from, to));
    pulse(8);
  }

  return (
    <div
      onPointerDown={() => {
        if (editing) {
          return;
        }
        hold.current = window.setTimeout(() => {
          pulse(12);
          onEditing(true);
        }, 480);
      }}
      onPointerMove={() => {
        if (hold.current) {
          window.clearTimeout(hold.current);
          hold.current = null;
        }
      }}
      onPointerUp={() => {
        if (hold.current) {
          window.clearTimeout(hold.current);
          hold.current = null;
        }
      }}
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((item) => item.id)} strategy={rectSortingStrategy}>
          <div className="widget-grid">
            {items.map((item) => (
              <WidgetFrame
                key={item.id}
                item={item}
                editing={editing}
                onRemove={() => onChange(items.filter((entry) => entry.id !== item.id))}
                onResize={() => onChange(items.map((entry) => entry.id === item.id ? { ...entry, size: NEXT_SIZE[entry.size] } : entry))}
              >
                <WidgetBody
                  item={item}
                  status={status}
                  tasks={tasks}
                  notes={notes}
                  messages={messages}
                  onOpen={onOpen}
                  onUsage={onUsage}
                  onCreate={onCreate}
                  locked={editing}
                />
              </WidgetFrame>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {editing ? (
        <div className="stack" style={{ marginTop: 12 }}>
          <button type="button" className="text-btn" onClick={() => setAdding((open) => !open)}>
            {t("widget.add")}
          </button>
          {adding ? (
            <div className="choice">
              {missing.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="text-btn ghost"
                  onClick={() => {
                    onChange([...items, { id: kind, kind, size: kind === "quick" || kind === "notes" || kind === "cost" || kind === "chat" ? "s" : "m" }]);
                    setAdding(false);
                  }}
                >
                  {label(kind, t)}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="text-btn ghost" onClick={() => onChange(DEFAULT_WIDGETS.map((item) => ({ ...item })))}>
            {t("widget.reset")}
          </button>
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
  }
}

function WidgetFrame({
  item,
  editing,
  onRemove,
  onResize,
  children,
}: {
  item: WidgetItem;
  editing: boolean;
  onRemove: () => void;
  onResize: () => void;
  children: ReactNode;
}) {
  const t = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id, disabled: !editing });
  return (
    <article
      ref={setNodeRef}
      className="widget"
      data-size={item.size}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(editing ? { ...attributes, ...listeners } : {})}
    >
      {editing ? (
        <div className="tools">
          <button type="button" aria-label={t("widget.remove")} onPointerDown={(event) => event.stopPropagation()} onClick={onRemove}>
            ×
          </button>
          <button type="button" aria-label={t("widget.grow")} onPointerDown={(event) => event.stopPropagation()} onClick={onResize}>
            ⤢
          </button>
        </div>
      ) : null}
      {children}
    </article>
  );
}

function WidgetBody({
  item,
  status,
  tasks,
  notes,
  messages,
  onOpen,
  onUsage,
  onCreate,
  locked,
}: {
  item: WidgetItem;
  status: StatusResponse | null;
  tasks: Task[];
  notes: Note[];
  messages: ChatMessage[];
  onOpen: (page: number) => void;
  onUsage: () => void;
  onCreate: (input: { titel: string }) => Promise<void>;
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
    return <Clock locked={locked} />;
  }
  if (item.kind === "status") {
    const bot = status?.telegram.connected ? "ok" : status?.telegram.configured ? "warn" : "bad";
    const model = status?.llm.configured && !status.llm.lastError ? "ok" : status?.llm.lastError ? "warn" : "bad";
    const mirror = status?.telegram.mirror ? "ok" : status?.telegram.configured ? "warn" : "bad";
    return (
      <div>
        <span className="kicker">{t("widget.status")}</span>
        <div className="lights">
          <div className="light"><span className={`dot ${bot}`} />{t("widget.bot")}</div>
          <div className="light"><span className={`dot ${model}`} />{t("widget.model")}</div>
          <div className="light"><span className={`dot ${mirror}`} />{t("widget.mirror")}</div>
        </div>
      </div>
    );
  }
  if (item.kind === "tasks") {
    const due = tasks.filter((task) => bucketTask(task, today) === "today").length;
    const overdue = tasks.filter((task) => bucketTask(task, today) === "overdue").length;
    const open = tasks.filter((task) => task.status !== "erledigt").length;
    return (
      <button type="button" className="row body" onClick={() => openTask(2)}>
        <span className="kicker">{t("widget.tasks")}</span>
        <h3>{t("widget.due", { count: due })}{overdue > 0 ? ` · ${t("widget.overdue", { count: overdue })}` : ""}</h3>
        <p className="muted">{t("widget.openCount", { count: open })}</p>
      </button>
    );
  }
  if (item.kind === "events") {
    const upcoming = tasks
      .filter((task) => task.status === "offen" && task.faelligAm && berlinParts(new Date(task.faelligAm)).key >= today)
      .sort((a, b) => (a.faelligAm ?? "").localeCompare(b.faelligAm ?? ""))
      .slice(0, 3);
    return (
      <button type="button" className="row body" onClick={() => openTask(0)}>
        <span className="kicker">{t("widget.events")}</span>
        {upcoming.length === 0 ? <p>{t("widget.noEvents")}</p> : upcoming.map((task) => (
          <p key={task.id}>{task.faelligAm ? clock(task.faelligAm) : ""} {task.titel}</p>
        ))}
      </button>
    );
  }
  if (item.kind === "cost") {
    const budget = status?.usage?.budget;
    const ratio = budget?.ratio ?? 0;
    return (
      <button type="button" className="row body" onClick={() => { if (!locked) onUsage(); }}>
        <span className="kicker">{t("widget.cost")}</span>
        <h3>{status?.usage ? t("widget.todayUsd", { amount: usd(status.usage.todayUsd) }) : t("widget.noNumbers")}</h3>
        {budget?.limitUsd ? (
          <div className="meter" role="meter" aria-label={t("usage.budget")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(1, ratio) * 100)}>
            <span data-level={budget.level} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
        ) : (
          <p>{status?.usage ? t("widget.monthUsd", { amount: usd(status.usage.monthUsd) }) : t("widget.noBudget")}</p>
        )}
      </button>
    );
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
  return <T3Status onOpen={() => openTask(4)} />;
}

function Clock({ locked }: { locked: boolean }) {
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
      {locked ? null : <p className="hint">{t("dash.costHint")}</p>}
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
