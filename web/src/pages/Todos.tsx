import { useMemo, useRef, useState } from "react";
import { berlinParts, bucketTask, type TaskBucket } from "@jarvis/dates.ts";
import { dragAxis, todoSwipeAction } from "@jarvis/gesture.ts";
import { clock, localInput, repeatLabel } from "../format.ts";
import type { Task, TaskStatus } from "../types.ts";
import { useI18n } from "../i18n/index.ts";
import { Empty, Sheet, Skeleton, pulse } from "../ui.tsx";

const ORDER: TaskBucket[] = ["overdue", "today", "soon", "undated", "done"];

const STATUSES: TaskStatus[] = ["offen", "in Arbeit", "erledigt", "fehlgeschlagen"];

function bucketTitle(bucket: TaskBucket, tr: (key: string) => string): string {
  switch (bucket) {
    case "overdue":
      return tr("tasks.overdue");
    case "today":
      return tr("tasks.today");
    case "soon":
      return tr("tasks.soon");
    case "undated":
      return tr("tasks.undated");
    case "done":
      return tr("tasks.done");
  }
}

export function Todos({
  tasks,
  loading,
  error,
  onRefresh,
  onCreate,
  onPatch,
  onDelete,
}: {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onCreate: (input: { titel: string; faelligAm?: string; wiederholung?: string }) => Promise<void>;
  onPatch: (id: string, patch: { titel?: string; aufgabe?: string; faelligAm?: string | null; wiederholung?: string | null; status?: TaskStatus }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const t = useI18n();
  const today = berlinParts(new Date()).key;
  const [doneOpen, setDoneOpen] = useState(false);
  const [titel, setTitel] = useState("");
  const [due, setDue] = useState("");
  const [repeat, setRepeat] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [toast, setToast] = useState<Task | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const groups = useMemo(() => {
    const buckets = new Map<TaskBucket, Task[]>();
    for (const task of tasks) {
      const bucket = bucketTask(task, today);
      const list = buckets.get(bucket) ?? [];
      list.push(task);
      buckets.set(bucket, list);
    }
    for (const list of buckets.values()) {
      list.sort((a, b) => (a.faelligAm ?? "9999").localeCompare(b.faelligAm ?? "9999"));
    }
    return buckets;
  }, [tasks, today]);

  async function add() {
    const text = titel.trim();
    if (!text) {
      return;
    }
    setFormError(null);
    try {
      await onCreate({
        titel: text,
        ...(due ? { faelligAm: due } : {}),
        ...(repeat ? { wiederholung: repeat } : {}),
      });
      setTitel("");
      setDue("");
      setRepeat("");
      pulse();
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t("tasks.failAdd"));
    }
  }

  async function remove(task: Task) {
    await onDelete(task.id);
    setToast(task);
    window.setTimeout(() => setToast((current) => (current?.id === task.id ? null : current)), 5000);
    pulse(16);
  }

  return (
    <div>
      <header className="top">
        <div>
          <p className="eyebrow">{t("tasks.kicker")}</p>
          <h1>{t("tasks.title")}</h1>
        </div>
        <button type="button" className="icon-btn" onClick={onRefresh} aria-label={t("common.refresh")}>
          {t("common.refresh")}
        </button>
      </header>
      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      <form
        className="stack"
        data-no-swipe
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label className="field">
          <span>{t("tasks.new")}</span>
          <input value={titel} onChange={(event) => setTitel(event.target.value)} placeholder={t("tasks.ph")} maxLength={200} />
        </label>
        <label className="field">
          <span>{t("tasks.due")}</span>
          <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
        </label>
        <label className="field">
          <span>{t("tasks.repeat")}</span>
          <select value={repeat} onChange={(event) => setRepeat(event.target.value)}>
            <option value="">{t("common.once")}</option>
            <option value="taeglich">{t("common.daily")}</option>
            <option value="woechentlich">{t("common.weekly")}</option>
          </select>
        </label>
        <button type="submit" className="text-btn">{t("tasks.add")}</button>
        {formError ? <p className="muted" role="alert">{formError}</p> : null}
      </form>
      {loading && tasks.length === 0 ? <Skeleton /> : null}
      {!loading && tasks.length === 0 ? (
        <Empty title={t("tasks.emptyTitle")} text={t("tasks.emptyBody")} />
      ) : null}
      {ORDER.map((group) => {
        const list = groups.get(group) ?? [];
        if (list.length === 0) {
          return null;
        }
        const collapsed = group === "done" && !doneOpen;
        return (
          <section className="group" key={group}>
            <header>
              <h2>{bucketTitle(group, t)}</h2>
              {group === "done" ? (
                <button type="button" className="text-btn ghost" onClick={() => setDoneOpen((open) => !open)} aria-expanded={!collapsed}>
                  {collapsed ? t("tasks.show", { count: list.length }) : t("tasks.hide")}
                </button>
              ) : (
                <span className="muted">{list.length}</span>
              )}
            </header>
            {collapsed ? null : list.map((task) => (
              <TodoRow
                key={task.id}
                task={task}
                onOpen={() => setEditing(task)}
                onDone={() => {
                  pulse();
                  void onPatch(task.id, { status: task.status === "erledigt" ? "offen" : "erledigt" });
                }}
                onDelete={() => void remove(task)}
              />
            ))}
          </section>
        );
      })}
      <Sheet open={Boolean(editing)} title={t("tasks.sheet")} onClose={() => setEditing(null)}>
        {editing ? (
          <EditForm
            task={editing}
            onClose={() => setEditing(null)}
            onPatch={onPatch}
            onDelete={async () => {
              await remove(editing);
              setEditing(null);
            }}
          />
        ) : null}
      </Sheet>
      {toast ? (
        <div className="toast" role="status">
          <span>{t("tasks.deleted", { title: toast.titel })}</span>
          <button
            type="button"
            className="text-btn ghost"
            onClick={() => {
              const task = toast;
              setToast(null);
              void onCreate({
                titel: task.titel,
                ...(task.faelligAm ? { faelligAm: task.faelligAm } : {}),
                ...(task.wiederholung ? { wiederholung: task.wiederholung } : {}),
              });
            }}
          >
            {t("tasks.undo")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TodoRow({
  task,
  onOpen,
  onDone,
  onDelete,
}: {
  task: Task;
  onOpen: () => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  const t = useI18n();
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const dragged = useRef(false);
  return (
    <div className="swipe" data-no-swipe>
      <div className="swipe-action done">{t("tasks.swipeDone")}</div>
      <div className="swipe-action delete">{t("tasks.swipeDelete")}</div>
      <div
        className="row"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        onPointerDown={(event) => {
          start.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
          dragged.current = false;
        }}
        onPointerMove={(event) => {
          if (!start.current || event.pointerId !== start.current.pointer) {
            return;
          }
          const next = event.clientX - start.current.x;
          const dy = event.clientY - start.current.y;
          const axis = dragAxis(next, dy);
          if (axis === "y") {
            setDx(0);
            return;
          }
          if (axis === "x") {
            dragged.current = true;
            setDx(Math.max(-120, Math.min(120, next)));
          }
        }}
        onPointerUp={() => {
          const action = todoSwipeAction(dx);
          setDx(0);
          start.current = null;
          if (action === "done") {
            onDone();
          } else if (action === "delete") {
            onDelete();
          }
        }}
        onPointerCancel={() => {
          setDx(0);
          start.current = null;
        }}
      >
        <button type="button" className={`check ${task.status === "erledigt" ? "on" : ""}`} aria-label={task.status === "erledigt" ? t("tasks.reopen") : t("tasks.complete")} onClick={onDone}>
          {task.status === "erledigt" ? "✓" : ""}
        </button>
        <button
          type="button"
          className="body"
          onClick={() => {
            if (!dragged.current) {
              onOpen();
            }
          }}
        >
          <h3>{task.titel}</h3>
          <p className="muted">
            {task.faelligAm ? clock(task.faelligAm) : t("tasks.noDate")} · {repeatLabel(task.wiederholung)}
            {task.status === "in Arbeit" ? ` · ${t("tasks.inProgress")}` : ""}
            {task.status === "fehlgeschlagen" ? ` · ${t("tasks.failed")}` : ""}
          </p>
        </button>
        {task.status === "in Arbeit" ? <span className="badge">{t("tasks.inProgress")}</span> : null}
        {task.status === "fehlgeschlagen" ? <span className="badge bad">{t("tasks.failed")}</span> : null}
      </div>
    </div>
  );
}

function statusText(status: TaskStatus, tr: (key: string) => string): string {
  if (status === "erledigt") return tr("tasks.done");
  if (status === "in Arbeit") return tr("tasks.inProgress");
  if (status === "fehlgeschlagen") return tr("tasks.failed");
  return tr("tasks.open");
}

function EditForm({
  task,
  onClose,
  onPatch,
  onDelete,
}: {
  task: Task;
  onClose: () => void;
  onPatch: (id: string, patch: { titel?: string; faelligAm?: string | null; wiederholung?: string | null; status?: TaskStatus }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useI18n();
  const [titel, setTitel] = useState(task.titel);
  const [due, setDue] = useState(task.faelligAm ? localInput(task.faelligAm) : "");
  const [repeat, setRepeat] = useState(task.wiederholung ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [formError, setFormError] = useState<string | null>(null);
  return (
    <form
      data-no-swipe
      onSubmit={(event) => {
        event.preventDefault();
        void onPatch(task.id, {
          titel: titel.trim(),
          faelligAm: due ? due : null,
          wiederholung: repeat ? repeat : null,
          status,
        })
          .then(onClose)
          .catch((caught: unknown) => {
            setFormError(caught instanceof Error ? caught.message : t("tasks.failSave"));
          });
      }}
    >
      <label className="field">
        <span>{t("cal.fieldTitle")}</span>
        <input value={titel} onChange={(event) => setTitel(event.target.value)} required maxLength={200} />
      </label>
      <label className="field">
        <span>{t("tasks.due")}</span>
        <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
      </label>
      <label className="field">
        <span>{t("tasks.repeat")}</span>
        <select value={repeat} onChange={(event) => setRepeat(event.target.value)}>
          <option value="">{t("common.once")}</option>
          <option value="taeglich">{t("common.daily")}</option>
          <option value="woechentlich">{t("common.weekly")}</option>
        </select>
      </label>
      <label className="field">
        <span>{t("tasks.status")}</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
          {STATUSES.map((item) => (
            <option key={item} value={item}>{statusText(item, t)}</option>
          ))}
        </select>
      </label>
      {formError ? <p role="alert">{formError}</p> : null}
      <div className="actions">
        <button type="submit" className="text-btn">{t("common.save")}</button>
        <button type="button" className="text-btn ghost" onClick={() => void onDelete()}>{t("common.delete")}</button>
      </div>
    </form>
  );
}
