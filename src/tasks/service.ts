import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type TaskStatus = "offen" | "in Arbeit" | "erledigt" | "fehlgeschlagen";

export type Task = {
  id: string;
  titel: string;
  aufgabe: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
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
};

export type TaskLogEntry = {
  at: string;
  taskId: string;
  event: "gestartet" | "erledigt" | "fehlgeschlagen";
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

  constructor(taskId: string, status: TaskStatus) {
    super(`Task ${taskId} kann nicht gestartet werden (Status: ${status})`);
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
};

const RUNNABLE = new Set<TaskStatus>(["offen", "fehlgeschlagen"]);

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

export function createTaskService(options: TaskServiceOptions) {
  const tasksFile = path.join(options.dataDir, "tasks.json");
  const logFile = path.join(options.dataDir, "task-log.jsonl");
  const processor =
    options.processor ??
    (async (task: Task) => `Erledigt: ${task.titel}`);
  const nowIso = () => (options.now ?? (() => new Date()))().toISOString();

  async function ensureDir() {
    await mkdir(options.dataDir, { recursive: true });
  }

  async function loadTasks(): Promise<Task[]> {
    try {
      const raw = await readFile(tasksFile, "utf8");
      const parsed: unknown = JSON.parse(raw);
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
    await ensureDir();
    await writeFile(tasksFile, `${JSON.stringify(tasks, null, 2)}\n`, "utf8");
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
    await appendLog({
      at: startedAt,
      taskId: id,
      event: "gestartet",
      status: "in Arbeit",
    });

    try {
      const result = await processor(started);
      const completedAt = nowIso();
      const done: Task = {
        ...started,
        status: "erledigt",
        updatedAt: completedAt,
        completedAt,
        result,
      };
      await saveTask(done);
      await appendLog({
        at: completedAt,
        taskId: id,
        event: "erledigt",
        status: "erledigt",
        message: result,
      });
      return done;
    } catch (error) {
      const failedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);
      const failed: Task = {
        ...started,
        status: "fehlgeschlagen",
        updatedAt: failedAt,
        failedAt,
        error: message,
      };
      await saveTask(failed);
      await appendLog({
        at: failedAt,
        taskId: id,
        event: "fehlgeschlagen",
        status: "fehlgeschlagen",
        error: message,
      });
      return failed;
    }
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

  return { create, get, list, run, log };
}

export type TaskService = ReturnType<typeof createTaskService>;
