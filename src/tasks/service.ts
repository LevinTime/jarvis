import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseJson, readText, writeTextAtomic } from "../atomic-file.ts";
import { nextOccurrence, type Wiederholung } from "./schedule.ts";

export type TaskStatus = "offen" | "in Arbeit" | "erledigt" | "fehlgeschlagen";

export type Task = {
  id: string;
  titel: string;
  aufgabe: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  faelligAm?: string;
  wiederholung?: Wiederholung;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  result?: string;
};

export type TaskInput = {
  id?: string;
  titel: string;
  aufgabe: string;
  faelligAm?: string;
  wiederholung?: string | null;
};

export type TaskPatch = {
  titel?: string;
  aufgabe?: string;
  faelligAm?: string | null;
  wiederholung?: string | null;
  status?: TaskStatus;
};

export type TaskLogEntry = {
  at: string;
  taskId: string;
  event: "gestartet" | "erledigt" | "fehlgeschlagen" | "zurückgesetzt";
  status: TaskStatus;
  message?: string;
  error?: string;
};

export type TaskProcessor = (task: Task) => Promise<string>;

export class TaskNotFoundError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`Task nicht gefunden: ${taskId}`);
    this.name = "TaskNotFoundError";
    this.taskId = taskId;
  }
}

export class TaskConflictError extends Error {
  readonly taskId: string;
  readonly status: TaskStatus;

  constructor(taskId: string, status: TaskStatus, action = "gestartet") {
    super(`Task ${taskId} kann nicht ${action} werden (Status: ${status})`);
    this.name = "TaskConflictError";
    this.taskId = taskId;
    this.status = status;
  }
}

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskValidationError";
  }
}

type TaskServiceOptions = {
  dataDir: string;
  processor?: TaskProcessor;
  now?: () => Date;
  timeZone?: string;
};

const RUNNABLE = new Set<TaskStatus>(["offen", "fehlgeschlagen"]);
const STATUSES = new Set<TaskStatus>(["offen", "in Arbeit", "erledigt", "fehlgeschlagen"]);

function hasFieldPatch(patch: TaskPatch): boolean {
  return (
    patch.titel !== undefined ||
    patch.aufgabe !== undefined ||
    patch.faelligAm !== undefined ||
    patch.wiederholung !== undefined
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function requiredText(value: string | undefined, field: string): string {
  const text = value?.trim() ?? "";
  if (!text) {
    throw new TaskValidationError(`${field} darf nicht leer sein`);
  }
  return text;
}

function optionalWiederholung(
  value: string | null | undefined,
): Wiederholung | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = value.trim();
  if (!text) {
    return undefined;
  }
  if (text === "taeglich" || text === "woechentlich") {
    return text;
  }
  throw new TaskValidationError(
    "wiederholung muss taeglich, woechentlich oder null sein",
  );
}

function optionalFaelligAm(value: string | undefined): string | undefined {
  const text = value?.trim() ?? "";
  if (!text) {
    return undefined;
  }
  if (!Number.isFinite(Date.parse(text))) {
    throw new TaskValidationError("faelligAm muss ein ISO-Datum sein");
  }
  return text;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createTaskService(options: TaskServiceOptions) {
  const tasksFile = path.join(options.dataDir, "tasks.json");
  const logFile = path.join(options.dataDir, "task-log.jsonl");
  const processor =
    options.processor ??
    (async (task: Task) => `Erledigt: ${task.titel}`);
  const nowIso = () => (options.now ?? (() => new Date()))().toISOString();
  const timeZone = options.timeZone ?? "Europe/Berlin";

  async function ensureDir() {
    await mkdir(options.dataDir, { recursive: true });
  }

  async function loadTasks(): Promise<Task[]> {
    try {
      const raw = await readText(tasksFile);
      const parsed = parseJson(raw, "tasks.json");
      if (!Array.isArray(parsed)) {
        throw new Error("tasks.json ist kein Array");
      }
      return parsed as Task[];
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  async function saveTasks(tasks: Task[]) {
    await writeTextAtomic(tasksFile, `${JSON.stringify(tasks, null, 2)}\n`);
  }

  async function appendLog(entry: TaskLogEntry) {
    await ensureDir();
    await writeFile(logFile, `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      flag: "a",
    });
  }

  async function saveTask(updated: Task): Promise<Task> {
    const tasks = await loadTasks();
    const index = tasks.findIndex((task) => task.id === updated.id);
    if (index === -1) {
      tasks.push(updated);
    } else {
      tasks[index] = updated;
    }
    await saveTasks(tasks);
    return updated;
  }

  async function create(input: TaskInput): Promise<Task> {
    const titel = requiredText(input.titel, "titel");
    const aufgabe = requiredText(input.aufgabe, "aufgabe");
    const faelligAm = optionalFaelligAm(input.faelligAm);
    const wiederholung = optionalWiederholung(input.wiederholung);
    const tasks = await loadTasks();
    const id = input.id?.trim() || randomUUID();
    if (tasks.some((task) => task.id === id)) {
      throw new TaskValidationError(`Task-ID existiert schon: ${id}`);
    }

    const timestamp = nowIso();
    const task: Task = {
      id,
      titel,
      aufgabe,
      status: "offen",
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(faelligAm ? { faelligAm } : {}),
      ...(wiederholung ? { wiederholung } : {}),
    };
    await saveTask(task);
    return task;
  }

  async function get(id: string): Promise<Task> {
    const tasks = await loadTasks();
    const task = tasks.find((item) => item.id === id);
    if (!task) {
      throw new TaskNotFoundError(id);
    }
    return task;
  }

  async function list(): Promise<Task[]> {
    return loadTasks();
  }

  async function persistStatus(
    task: Task,
    entry: TaskLogEntry,
  ): Promise<Task> {
    await saveTask(task);
    try {
      await appendLog(entry);
    } catch {
      // Status ist schon terminal gespeichert.
    }
    return task;
  }

  async function markFailed(started: Task, message: string): Promise<Task> {
    const failedAt = nowIso();
    return persistStatus(
      {
        ...started,
        status: "fehlgeschlagen",
        updatedAt: failedAt,
        failedAt,
        error: message,
      },
      {
        at: failedAt,
        taskId: started.id,
        event: "fehlgeschlagen",
        status: "fehlgeschlagen",
        error: message,
      },
    );
  }

  async function run(id: string): Promise<Task> {
    const current = await get(id);
    if (!RUNNABLE.has(current.status)) {
      throw new TaskConflictError(id, current.status);
    }

    const startedAt = nowIso();
    const started: Task = {
      ...current,
      status: "in Arbeit",
      updatedAt: startedAt,
      startedAt,
      error: undefined,
      result: undefined,
      failedAt: undefined,
      completedAt: undefined,
    };
    await saveTask(started);
    try {
      await appendLog({
        at: startedAt,
        taskId: id,
        event: "gestartet",
        status: "in Arbeit",
      });
    } catch {
      // in Arbeit ist gespeichert, Processor darf trotzdem laufen.
    }

    let result: string;
    try {
      result = await processor(started);
    } catch (error) {
      return markFailed(started, errorMessage(error));
    }

    const completedAt = nowIso();
    const finished: Task = {
      ...started,
      status: "erledigt",
      updatedAt: completedAt,
      completedAt,
      result,
    };
    let done: Task;
    try {
      done = await persistStatus(finished, {
        at: completedAt,
        taskId: id,
        event: "erledigt",
        status: "erledigt",
        message: result,
      });
    } catch (error) {
      return markFailed(started, errorMessage(error));
    }

    if (done.wiederholung === "taeglich" || done.wiederholung === "woechentlich") {
      const base = done.faelligAm ?? done.completedAt ?? completedAt;
      await create({
        titel: done.titel,
        aufgabe: done.aufgabe,
        wiederholung: done.wiederholung,
        faelligAm: nextOccurrence(base, done.wiederholung, timeZone),
      });
    }
    return done;
  }

  async function recoverStale(maxAgeMinuten = 30): Promise<Task[]> {
    const nowMs = (options.now ?? (() => new Date()))().getTime();
    const maxAgeMs = maxAgeMinuten * 60 * 1000;
    const recovered: Task[] = [];

    for (const task of await loadTasks()) {
      if (task.status !== "in Arbeit") {
        continue;
      }
      const startedMs = Date.parse(task.startedAt ?? task.updatedAt);
      if (!Number.isFinite(startedMs) || nowMs - startedMs <= maxAgeMs) {
        continue;
      }
      recovered.push(await markFailed(task, "abgebrochen"));
    }

    return recovered;
  }

  async function reset(id: string): Promise<Task> {
    const current = await get(id);
    if (current.status !== "in Arbeit") {
      throw new TaskConflictError(id, current.status, "zurückgesetzt");
    }

    const timestamp = nowIso();
    const resetTask: Task = {
      ...current,
      status: "offen",
      updatedAt: timestamp,
      startedAt: undefined,
      completedAt: undefined,
      failedAt: undefined,
      error: undefined,
      result: undefined,
    };
    await saveTask(resetTask);
    try {
      await appendLog({
        at: timestamp,
        taskId: id,
        event: "zurückgesetzt",
        status: "offen",
      });
    } catch {
      // Reset-Status zählt.
    }
    return resetTask;
  }

  async function applyFields(task: Task, patch: TaskPatch): Promise<Task> {
    const next: Task = { ...task, updatedAt: nowIso() };
    if (patch.titel !== undefined) {
      next.titel = requiredText(patch.titel, "titel");
    }
    if (patch.aufgabe !== undefined) {
      next.aufgabe = requiredText(patch.aufgabe, "aufgabe");
    }
    if (patch.faelligAm !== undefined) {
      if (patch.faelligAm === null || patch.faelligAm.trim() === "") {
        delete next.faelligAm;
      } else {
        const faelligAm = optionalFaelligAm(patch.faelligAm);
        if (faelligAm) {
          next.faelligAm = faelligAm;
        }
      }
    }
    if (patch.wiederholung !== undefined) {
      const wiederholung = optionalWiederholung(patch.wiederholung);
      if (wiederholung) {
        next.wiederholung = wiederholung;
      } else {
        delete next.wiederholung;
      }
    }
    return saveTask(next);
  }

  async function update(id: string, patch: TaskPatch): Promise<Task> {
    if (patch.status !== undefined && !STATUSES.has(patch.status)) {
      throw new TaskValidationError("status ist ungültig");
    }
    const current = await get(id);
    if (patch.status === "erledigt" && current.status !== "erledigt") {
      if (hasFieldPatch(patch)) {
        await applyFields(current, patch);
      }
      const ready = await get(id);
      if (!RUNNABLE.has(ready.status)) {
        throw new TaskConflictError(id, ready.status);
      }
      return run(id);
    }
    if (patch.status === "offen" && current.status === "in Arbeit") {
      const resetTask = await reset(id);
      return hasFieldPatch(patch) ? applyFields(resetTask, patch) : resetTask;
    }
    const base = hasFieldPatch(patch) ? await applyFields(current, patch) : current;
    if (patch.status === undefined || patch.status === base.status) {
      return base;
    }
    const timestamp = nowIso();
    const next: Task = { ...base, status: patch.status, updatedAt: timestamp };
    if (patch.status === "offen") {
      delete next.startedAt;
      delete next.completedAt;
      delete next.failedAt;
      delete next.error;
      delete next.result;
    }
    if (patch.status === "in Arbeit") {
      next.startedAt = base.startedAt ?? timestamp;
    }
    if (patch.status === "fehlgeschlagen") {
      next.failedAt = timestamp;
      next.error = base.error ?? "manuell markiert";
    }
    return saveTask(next);
  }

  async function remove(id: string): Promise<void> {
    const tasks = await loadTasks();
    const next = tasks.filter((task) => task.id !== id);
    if (next.length === tasks.length) {
      throw new TaskNotFoundError(id);
    }
    await saveTasks(next);
  }

  async function log(taskId?: string): Promise<TaskLogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(logFile, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return JSON.parse(line) as TaskLogEntry;
        } catch {
          throw new Error(`task-log.jsonl Zeile ${index + 1} ist ungültig`);
        }
      })
      .filter((entry) => (taskId ? entry.taskId === taskId : true));
  }

  return { create, get, list, run, log, recoverStale, reset, update, remove };
}

export type TaskService = ReturnType<typeof createTaskService>;
