import { useMemo, useRef, useState } from "react";
import { berlinParts, bucketTask, type TaskBucket } from "@jarvis/dates.ts";
import { dragAxis, todoSwipeAction } from "@jarvis/gesture.ts";
import { clock, localInput, repeatLabel } from "../format.ts";
import type { Task, TaskStatus } from "../types.ts";
import { Empty, Sheet, Skeleton, pulse } from "../ui.tsx";

const ORDER: Array<{ id: TaskBucket; title: string }> = [
  { id: "overdue", title: "Überfällig" },
  { id: "today", title: "Heute" },
  { id: "soon", title: "Demnächst" },
  { id: "undated", title: "Ohne Datum" },
  { id: "done", title: "Erledigt" },
];

const STATUSES: TaskStatus[] = ["offen", "in Arbeit", "erledigt", "fehlgeschlagen"];

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
      setFormError(caught instanceof Error ? caught.message : "Anlegen fehlgeschlagen");
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
          <p className="eyebrow">Aufgaben</p>
          <h1>Was ansteht</h1>
        </div>
        <button type="button" className="icon-btn" onClick={onRefresh} aria-label="Aktualisieren">
          Neu
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
          <span>Neu</span>
          <input value={titel} onChange={(event) => setTitel(event.target.value)} placeholder="Hühner füttern" maxLength={200} />
        </label>
        <label className="field">
          <span>Fällig</span>
          <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
        </label>
        <label className="field">
          <span>Wiederholung</span>
          <select value={repeat} onChange={(event) => setRepeat(event.target.value)}>
            <option value="">einmal</option>
            <option value="taeglich">täglich</option>
            <option value="woechentlich">wöchentlich</option>
          </select>
        </label>
        <button type="submit" className="text-btn">Hinzufügen</button>
        {formError ? <p className="muted" role="alert">{formError}</p> : null}
      </form>
      {loading && tasks.length === 0 ? <Skeleton /> : null}
      {!loading && tasks.length === 0 ? (
        <Empty title="Noch keine Aufgaben" text="Sag Jarvis einfach, was ansteht." />
      ) : null}
      {ORDER.map((group) => {
        const list = groups.get(group.id) ?? [];
        if (list.length === 0) {
          return null;
        }
        const collapsed = group.id === "done" && !doneOpen;
        return (
          <section className="group" key={group.id}>
            <header>
              <h2>{group.title}</h2>
              {group.id === "done" ? (
                <button type="button" className="text-btn ghost" onClick={() => setDoneOpen((open) => !open)} aria-expanded={!collapsed}>
                  {collapsed ? `${list.length} zeigen` : "einklappen"}
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
      <Sheet open={Boolean(editing)} title="Aufgabe" onClose={() => setEditing(null)}>
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
          <span>Gelöscht: {toast.titel}</span>
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
            Rückgängig
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
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const dragged = useRef(false);
  return (
    <div
      className="row"
      data-no-swipe
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, background: dx > 24 ? "rgba(142,215,176,0.16)" : dx < -24 ? "rgba(240,139,124,0.16)" : undefined }}
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
          setDx(Math.max(-140, Math.min(140, next)));
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
      <button type="button" className={`check ${task.status === "erledigt" ? "on" : ""}`} aria-label={task.status === "erledigt" ? "Wieder öffnen" : "Erledigen"} onClick={onDone}>
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
          {task.faelligAm ? clock(task.faelligAm) : "ohne Datum"} · {repeatLabel(task.wiederholung)}
          {task.status === "in Arbeit" ? " · in Arbeit" : ""}
          {task.status === "fehlgeschlagen" ? " · fehlgeschlagen" : ""}
        </p>
      </button>
      {task.status === "in Arbeit" ? <span className="badge">in Arbeit</span> : null}
      {task.status === "fehlgeschlagen" ? <span className="badge bad">fehlgeschlagen</span> : null}
    </div>
  );
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
            setFormError(caught instanceof Error ? caught.message : "Speichern fehlgeschlagen");
          });
      }}
    >
      <label className="field">
        <span>Titel</span>
        <input value={titel} onChange={(event) => setTitel(event.target.value)} required maxLength={200} />
      </label>
      <label className="field">
        <span>Fällig</span>
        <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} />
      </label>
      <label className="field">
        <span>Wiederholung</span>
        <select value={repeat} onChange={(event) => setRepeat(event.target.value)}>
          <option value="">einmal</option>
          <option value="taeglich">täglich</option>
          <option value="woechentlich">wöchentlich</option>
        </select>
      </label>
      <label className="field">
        <span>Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>
          {STATUSES.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>
      {formError ? <p role="alert">{formError}</p> : null}
      <div className="actions">
        <button type="submit" className="text-btn">Sichern</button>
        <button type="button" className="text-btn ghost" onClick={() => void onDelete()}>Löschen</button>
      </div>
    </form>
  );
}
