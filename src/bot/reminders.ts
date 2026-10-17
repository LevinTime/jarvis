import path from "node:path";
import { parseJson, readText, writeTextAtomic } from "../atomic-file.ts";
import { logError } from "../log.ts";
import type { Note, NoteService } from "../notes/service.ts";
import type { Task, TaskService } from "../tasks/service.ts";

export type ReminderState = {
  sent: Record<string, string>;
  notesSent?: Record<string, string>;
  lastDailyOverview?: string;
};

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function berlinParts(
  now: Date,
  timeZone = "Europe/Berlin",
): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function findDueOpenTasks(
  tasks: Task[],
  now: Date,
  sent: Record<string, string>,
): Task[] {
  const nowMs = now.getTime();
  return tasks.filter((task) => {
    if (task.status !== "offen" || !task.faelligAm) {
      return false;
    }
    if (sent[task.id] === task.faelligAm) {
      return false;
    }
    const due = Date.parse(task.faelligAm);
    return Number.isFinite(due) && due <= nowMs;
  });
}

export function shouldSendDailyOverview(
  now: Date,
  lastDailyOverview: string | undefined,
  timeZone = "Europe/Berlin",
): boolean {
  const { date, hour } = berlinParts(now, timeZone);
  return hour === 8 && lastDailyOverview !== date;
}

export function findDueOpenNotes(
  notes: Note[],
  now: Date,
  sent: Record<string, string>,
): Note[] {
  const nowMs = now.getTime();
  return notes.filter((note) => {
    if (!note.offen || !note.erinnernAm) {
      return false;
    }
    if (sent[note.id] === note.erinnernAm) {
      return false;
    }
    const due = Date.parse(note.erinnernAm);
    return Number.isFinite(due) && due <= nowMs;
  });
}

export function formatDueReminder(task: Task): string {
  const due = task.faelligAm ? `\nfällig: ${task.faelligAm}` : "";
  return `Erinnerung: ${task.titel}\n${task.aufgabe}${due}`;
}

export function formatDueNote(note: Note): string {
  const who = note.person ? `${note.person}: ` : "";
  const due = note.erinnernAm ? `\nerinnern: ${note.erinnernAm}` : "";
  return `Offener Punkt: ${who}${note.text}${due}`;
}

export function formatDailyOverview(
  tasks: Task[],
  date: string,
  notes: Note[] = [],
): string {
  const open = tasks.filter((task) => task.status === "offen");
  const head =
    open.length === 0
      ? `Guten Morgen. Keine offenen Aufgaben (${date}).`
      : `Guten Morgen. Heute steht an:\n${open
          .map((task) => {
            const due = task.faelligAm ? ` — bis ${task.faelligAm}` : "";
            return `• ${task.titel}${due}`;
          })
          .join("\n")}`;
  const openNotes = notes.filter((note) => note.offen);
  if (openNotes.length === 0) {
    return head;
  }
  const lines = openNotes.map((note) => {
    const who = note.person ? `${note.person}: ` : "";
    const due = note.erinnernAm ? ` — erinnern ${note.erinnernAm}` : "";
    return `• ${who}${note.text}${due}`;
  });
  return `${head}\n\nOffene Punkte:\n${lines.join("\n")}`;
}

export async function loadReminderState(dataDir: string): Promise<ReminderState> {
  try {
    const raw = await readText(path.join(dataDir, "reminder-state.json"));
    const parsed = parseJson(raw, "reminder-state.json");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { sent: {} };
    }
    const record = parsed as Record<string, unknown>;
    const asMap = (value: unknown): Record<string, string> =>
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, string>)
        : {};
    const sent = asMap(record.sent);
    const notesSent = record.notesSent === undefined ? undefined : asMap(record.notesSent);
    return {
      sent,
      ...(notesSent ? { notesSent } : {}),
      lastDailyOverview:
        typeof record.lastDailyOverview === "string"
          ? record.lastDailyOverview
          : undefined,
    };
  } catch (error) {
    if (isNotFound(error)) {
      return { sent: {} };
    }
    throw error;
  }
}

export async function saveReminderState(
  dataDir: string,
  state: ReminderState,
): Promise<void> {
  await writeTextAtomic(
    path.join(dataDir, "reminder-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

export async function runReminderTick(options: {
  tasks: TaskService;
  notes?: NoteService;
  send: (text: string) => Promise<void>;
  dataDir: string;
  now?: Date;
  timeZone?: string;
}): Promise<void> {
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? "Europe/Berlin";
  const listed = await options.tasks.list();
  const noteList = options.notes ? await options.notes.list() : [];
  const state = await loadReminderState(options.dataDir);

  for (const task of findDueOpenTasks(listed, now, state.sent)) {
    await options.send(formatDueReminder(task));
    if (task.faelligAm) {
      state.sent[task.id] = task.faelligAm;
    }
    await saveReminderState(options.dataDir, state);
  }

  const notesSent = state.notesSent ?? {};
  for (const note of findDueOpenNotes(noteList, now, notesSent)) {
    await options.send(formatDueNote(note));
    if (note.erinnernAm) {
      notesSent[note.id] = note.erinnernAm;
      state.notesSent = notesSent;
    }
    await saveReminderState(options.dataDir, state);
  }

  if (shouldSendDailyOverview(now, state.lastDailyOverview, timeZone)) {
    const { date } = berlinParts(now, timeZone);
    await options.send(formatDailyOverview(listed, date, noteList));
    state.lastDailyOverview = date;
    await saveReminderState(options.dataDir, state);
  }
}

export function startReminders(options: {
  tasks: TaskService;
  notes?: NoteService;
  send: (text: string) => Promise<void>;
  dataDir: string;
  now?: () => Date;
  timeZone?: string;
  intervalMs?: number;
}): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 60_000;
  let stopped = false;

  async function tick() {
    if (stopped) {
      return;
    }
    await runReminderTick({
      tasks: options.tasks,
      notes: options.notes,
      send: options.send,
      dataDir: options.dataDir,
      now: (options.now ?? (() => new Date()))(),
      timeZone: options.timeZone,
    });
  }

  const handle = setInterval(() => {
    void tick().catch((error) => {
      logError("Erinnerung fehlgeschlagen", error);
    });
  }, intervalMs);

  void tick().catch((error) => {
    logError("Erinnerung fehlgeschlagen", error);
  });

  return {
    stop() {
      stopped = true;
      clearInterval(handle);
    },
  };
}
