import type { TaskService } from "../tasks/service.ts";
import type { TranscriptService } from "../transcripts/service.ts";

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type LlmResult = {
  content: string | null;
  tool_calls?: ToolCall[];
};

export type LlmClient = {
  complete(input: {
    messages: LlmMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmResult>;
};

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "add_task",
      description:
        "Legt eine Aufgabe an. Bei mehreren Punkten in einer Nachricht mehrfach aufrufen.",
      parameters: {
        type: "object",
        properties: {
          titel: { type: "string", description: "Kurzer Titel" },
          aufgabe: { type: "string", description: "Was zu tun ist" },
          faelligAm: {
            type: "string",
            description:
              "Optionales Fälligkeitsdatum als ISO-8601, z. B. 2026-10-17T18:00:00+02:00",
          },
        },
        required: ["titel", "aufgabe"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_tasks",
      description: "Listet alle Aufgaben mit Status und optionalem faelligAm.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "complete_task",
      description: "Markiert eine Aufgabe als erledigt.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Task-ID" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_transcripts",
      description: "Listet vorhandene Gesprächsprotokolle (id, Titel, Anzahl Einträge).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_transcript",
      description: "Lädt ein Gesprächsprotokoll inklusive Einträge.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Transkript-ID, z. B. 2026-10-16" },
        },
        required: ["id"],
      },
    },
  },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asArgs(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function formatNow(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}

export function createBotTools(
  tasks: TaskService,
  transcripts: TranscriptService,
) {
  async function execute(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    try {
      switch (name) {
        case "add_task": {
          const faelligAm = asString(args.faelligAm).trim();
          const task = await tasks.create({
            titel: asString(args.titel),
            aufgabe: asString(args.aufgabe),
            ...(faelligAm ? { faelligAm } : {}),
          });
          return JSON.stringify({ ok: true, task });
        }
        case "list_tasks": {
          const listed = await tasks.list();
          return JSON.stringify({ tasks: listed });
        }
        case "complete_task": {
          const task = await tasks.run(asString(args.id));
          return JSON.stringify({ ok: true, task });
        }
        case "list_transcripts": {
          const listed = await transcripts.list();
          return JSON.stringify({
            transcripts: listed.map((item) => ({
              id: item.id,
              title: item.title,
              entries: item.entries.length,
            })),
          });
        }
        case "get_transcript": {
          const transcript = await transcripts.get(asString(args.id));
          return JSON.stringify({ transcript });
        }
        default:
          return JSON.stringify({ error: `Unbekanntes Werkzeug: ${name}` });
      }
    } catch (error) {
      return JSON.stringify({ error: errorMessage(error) });
    }
  }

  return { definitions: TOOL_DEFINITIONS, execute };
}

export async function chatWithTools(options: {
  llm: LlmClient;
  systemPrompt: string;
  userText: string;
  tools: ToolDefinition[];
  execute: (name: string, args: Record<string, unknown>) => Promise<string>;
  now?: Date;
  timeZone?: string;
  maxRounds?: number;
}): Promise<string> {
  const timeZone = options.timeZone ?? "Europe/Berlin";
  const now = options.now ?? new Date();
  const messages: LlmMessage[] = [
    {
      role: "system",
      content: `${options.systemPrompt.trim()}\n\nAktuelle Zeit: ${formatNow(now, timeZone)} (${timeZone})`,
    },
    { role: "user", content: options.userText },
  ];
  const maxRounds = options.maxRounds ?? 8;

  for (let round = 0; round < maxRounds; round++) {
    const result = await options.llm.complete({
      messages,
      tools: options.tools,
    });
    if (result.tool_calls && result.tool_calls.length > 0) {
      messages.push({
        role: "assistant",
        content: result.content,
        tool_calls: result.tool_calls,
      });
      for (const call of result.tool_calls) {
        const payload = await options.execute(call.name, asArgs(call.arguments));
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: payload,
        });
      }
      continue;
    }
    const text = result.content?.trim() ?? "";
    if (text) {
      return text;
    }
    return "Ich habe gerade keine Antwort.";
  }

  return "Zu viele Werkzeug-Aufrufe, ich breche ab.";
}
