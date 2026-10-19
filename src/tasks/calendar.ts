import {
  addDays,
  dayKey,
  nextOccurrence,
  startOfDay,
  startOfWeek,
  type Wiederholung,
} from "./schedule.ts";
import type { Task, TaskStatus } from "./service.ts";

export type CalendarItem = {
  taskId: string;
  titel: string;
  aufgabe: string;
  status: TaskStatus;
  faelligAm: string;
  wiederholung?: Wiederholung;
  projected: boolean;
};

function inWindow(iso: string, fromMs: number, toMs: number): boolean {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms >= fromMs && ms < toMs;
}

export function expandTasks(
  tasks: Task[],
  fromIso: string,
  toIso: string,
  timeZone = "Europe/Berlin",
): CalendarItem[] {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    throw new Error("from und to müssen ein gültiger Zeitraum sein");
  }
  const items: CalendarItem[] = [];
  const seen = new Set<string>();

  function push(task: Task, faelligAm: string, projected: boolean) {
    if (!inWindow(faelligAm, fromMs, toMs)) {
      return;
    }
    const key = `${task.id}|${faelligAm}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push({
      taskId: task.id,
      titel: task.titel,
      aufgabe: task.aufgabe,
      status: task.status,
      faelligAm,
      projected,
      ...(task.wiederholung ? { wiederholung: task.wiederholung } : {}),
    });
  }

  for (const task of tasks) {
    if (!task.faelligAm) {
      continue;
    }
    push(task, task.faelligAm, false);
    if (
      task.status !== "offen" ||
      (task.wiederholung !== "taeglich" && task.wiederholung !== "woechentlich")
    ) {
      continue;
    }
    let cursor = task.faelligAm;
    const guard = new Set<string>([cursor]);
    for (let step = 0; step < 400; step += 1) {
      const next = nextOccurrence(cursor, task.wiederholung, timeZone);
      if (guard.has(next)) {
        break;
      }
      guard.add(next);
      const ms = Date.parse(next);
      if (!Number.isFinite(ms) || ms >= toMs) {
        break;
      }
      push(task, next, true);
      cursor = next;
    }
  }

  items.sort(
    (a, b) => a.faelligAm.localeCompare(b.faelligAm) || a.titel.localeCompare(b.titel, "de"),
  );
  return items;
}

export function filterTasks(
  tasks: Task[],
  query: { status?: string; faellig?: string },
  now: Date,
  timeZone = "Europe/Berlin",
): Task[] {
  let result = tasks;
  if (query.status) {
    result = result.filter((task) => task.status === query.status);
  }
  if (query.faellig === "heute") {
    const key = dayKey(now, timeZone);
    result = result.filter(
      (task) => task.faelligAm !== undefined && dayKey(new Date(task.faelligAm), timeZone) === key,
    );
  } else if (query.faellig === "ueberfaellig") {
    const start = startOfDay(now, timeZone).getTime();
    result = result.filter((task) => {
      if (!task.faelligAm || task.status === "erledigt") {
        return false;
      }
      const due = Date.parse(task.faelligAm);
      return Number.isFinite(due) && due < start;
    });
  } else if (query.faellig === "woche") {
    const start = startOfWeek(now, timeZone);
    const end = addDays(start, 7, timeZone).getTime();
    const startMs = start.getTime();
    result = result.filter((task) => {
      if (!task.faelligAm) {
        return false;
      }
      const due = Date.parse(task.faelligAm);
      return Number.isFinite(due) && due >= startMs && due < end;
    });
  }
  return result;
}
