import { parseArgs } from "node:util";
import path from "node:path";
import {
  createTaskService,
  TaskValidationError,
  type Task,
  type TaskLogEntry,
} from "./tasks/service.ts";
import {
  createTranscriptService,
  type Transcript,
} from "./transcripts/service.ts";

export type CliIo = {
  dataDir?: string;
  transcriptsDir?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
};

function formatTask(task: Task): string {
  const lines = [
    `id: ${task.id}`,
    `titel: ${task.titel}`,
    `aufgabe: ${task.aufgabe}`,
    `status: ${task.status}`,
    `createdAt: ${task.createdAt}`,
    `updatedAt: ${task.updatedAt}`,
  ];
  if (task.faelligAm) lines.push(`faelligAm: ${task.faelligAm}`);
  if (task.startedAt) lines.push(`startedAt: ${task.startedAt}`);
  if (task.completedAt) lines.push(`completedAt: ${task.completedAt}`);
  if (task.failedAt) lines.push(`failedAt: ${task.failedAt}`);
  if (task.result) lines.push(`result: ${task.result}`);
  if (task.error) lines.push(`error: ${task.error}`);
  return lines.join("\n");
}

function formatLog(entry: TaskLogEntry): string {
  const parts = [`${entry.at}  ${entry.taskId}  ${entry.event}  ${entry.status}`];
  if (entry.message) parts.push(entry.message);
  if (entry.error) parts.push(entry.error);
  return parts.join("  ");
}

function usage(): string {
  return [
    "Jarvis Task-CLI",
    "",
    "  add --titel <text> --aufgabe <text> [--id <id>] [--faelligAm <iso>]",
    "  add --json <objekt>",
    "  get <id>",
    "  list",
    "  run <id>",
    "  reset <id>",
    "  log [id]",
    "  transcripts",
    "  transcript <id>",
  ].join("\n");
}

function formatTranscriptListItem(transcript: Transcript): string {
  return `${transcript.id}  ${transcript.title}  (${transcript.entries.length})`;
}

function formatTranscript(transcript: Transcript): string {
  const lines = [transcript.title, ""];
  for (const entry of transcript.entries) {
    lines.push(`${entry.uhrzeit}  ${entry.sprecher}  ${entry.text}`);
  }
  return lines.join("\n").trimEnd();
}

function failMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function jsonObject(raw: string): {
  id?: string;
  titel?: string;
  aufgabe?: string;
  faelligAm?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TaskValidationError("JSON ungültig");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TaskValidationError("JSON muss ein Objekt mit titel und aufgabe sein");
  }
  const record = parsed as Record<string, unknown>;
  return {
    id: typeof record.id === "string" ? record.id : undefined,
    titel: typeof record.titel === "string" ? record.titel : undefined,
    aufgabe: typeof record.aufgabe === "string" ? record.aufgabe : undefined,
    faelligAm: typeof record.faelligAm === "string" ? record.faelligAm : undefined,
  };
}

export async function runCli(
  argv: string[],
  io: CliIo = {},
): Promise<number> {
  const out = io.stdout ?? ((line: string) => console.log(line));
  const err = io.stderr ?? ((line: string) => console.error(line));
  const dataDir =
    io.dataDir ?? process.env.JARVIS_DATA_DIR ?? path.resolve("data");
  const transcriptsDir =
    io.transcriptsDir ??
    process.env.JARVIS_TRANSCRIPTS_DIR ??
    path.resolve("transcripts");
  const service = createTaskService({ dataDir });
  const transcripts = createTranscriptService({ transcriptsDir });

  try {
    await service.recoverStale();

    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
      out(usage());
      return 0;
    }

    const command = argv[0];
    const rest = argv.slice(1);
    if (command === "add") {
      const parsed = parseArgs({
        args: rest,
        options: {
          titel: { type: "string" },
          aufgabe: { type: "string" },
          id: { type: "string" },
          json: { type: "string" },
          faelligAm: { type: "string" },
        },
        allowPositionals: false,
      });
      const fromJson = parsed.values.json ? jsonObject(parsed.values.json) : {};
      const task = await service.create({
        id: parsed.values.id ?? fromJson.id,
        titel: parsed.values.titel ?? fromJson.titel ?? "",
        aufgabe: parsed.values.aufgabe ?? fromJson.aufgabe ?? "",
        faelligAm: parsed.values.faelligAm ?? fromJson.faelligAm,
      });
      out(`angelegt  ${task.id}  ${task.status}  ${task.titel}`);
      return 0;
    }

    if (command === "get") {
      const id = rest[0];
      if (!id) {
        err("get braucht eine id");
        return 1;
      }
      out(formatTask(await service.get(id)));
      return 0;
    }

    if (command === "list") {
      const tasks = await service.list();
      if (tasks.length === 0) {
        out("keine tasks");
        return 0;
      }
      for (const task of tasks) {
        out(`${task.id}  ${task.status}  ${task.titel}`);
      }
      return 0;
    }

    if (command === "run") {
      const id = rest[0];
      if (!id) {
        err("run braucht eine id");
        return 1;
      }
      const task = await service.run(id);
      if (task.status === "fehlgeschlagen") {
        err(`fehlgeschlagen  ${task.id}  ${task.error ?? ""}`.trim());
        return 1;
      }
      out(`erledigt  ${task.id}  ${task.result ?? task.titel}`);
      return 0;
    }

    if (command === "reset") {
      const id = rest[0];
      if (!id) {
        err("reset braucht eine id");
        return 1;
      }
      const task = await service.reset(id);
      out(`offen  ${task.id}  ${task.titel}`);
      return 0;
    }

    if (command === "log") {
      const entries = await service.log(rest[0]);
      if (entries.length === 0) {
        out("kein log");
        return 0;
      }
      for (const entry of entries) {
        out(formatLog(entry));
      }
      return 0;
    }

    if (command === "transcripts") {
      const listed = await transcripts.list();
      if (listed.length === 0) {
        out("keine transkripte");
        return 0;
      }
      for (const item of listed) {
        out(formatTranscriptListItem(item));
      }
      return 0;
    }

    if (command === "transcript") {
      const id = rest[0];
      if (!id) {
        err("transcript braucht eine id");
        return 1;
      }
      out(formatTranscript(await transcripts.get(id)));
      return 0;
    }

    err(`unbekanntes Kommando: ${command}`);
    err(usage());
    return 1;
  } catch (error) {
    err(failMessage(error));
    return 1;
  }
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("/cli.ts") || entry?.endsWith("/cli.js")) {
  const { loadEnv } = await import("./load-env.ts");
  loadEnv();
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}
