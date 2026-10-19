import {
  chatWithTools,
  createBotTools,
  type LlmClient,
  type LlmMessage,
  type LlmResult,
} from "./bot/tools.ts";
import type { EventBus } from "./events.ts";
import { germanLlmError } from "./llm-error.ts";
import { logError } from "./log.ts";
import {
  type ChatMessage,
  type ChatSource,
  type MessageStore,
} from "./messages/store.ts";
import type { NoteService } from "./notes/service.ts";
import type { TaskService } from "./tasks/service.ts";
import type { TranscriptService } from "./transcripts/service.ts";
import type { UsageSource } from "./usage/types.ts";

export type Assistant = {
  reply(userText: string): Promise<string>;
};

export function createAssistant(options: {
  llm: LlmClient;
  systemPrompt: string;
  tasks: TaskService;
  transcripts: TranscriptService;
  notes?: NoteService;
  timeZone?: string;
  now?: () => Date;
}): Assistant {
  const tools = createBotTools(options.tasks, options.transcripts, options.notes);
  return {
    reply(userText: string) {
      return chatWithTools({
        llm: options.llm,
        systemPrompt: options.systemPrompt,
        userText,
        tools: tools.definitions,
        execute: tools.execute,
        timeZone: options.timeZone,
        now: options.now?.(),
      });
    },
  };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function toContext(
  messages: ChatMessage[],
  options: { maxMessages?: number; maxTokens?: number } = {},
): LlmMessage[] {
  const maxMessages = options.maxMessages ?? 8;
  const maxTokens = options.maxTokens ?? 2_000;
  const usable = messages.filter((message) => {
    if (message.status === "pending") {
      return false;
    }
    if (message.role === "user" && message.status === "error") {
      return false;
    }
    return message.role === "user" || message.role === "assistant";
  });
  const selected: ChatMessage[] = [];
  let tokens = 0;
  for (let index = usable.length - 1; index >= 0; index -= 1) {
    const message = usable[index];
    if (!message) {
      continue;
    }
    if (selected.length >= maxMessages) {
      break;
    }
    const next = estimateTokens(message.text);
    if (tokens + next > maxTokens && selected.length > 0) {
      break;
    }
    tokens += next;
    selected.push(message);
  }
  selected.reverse();
  return selected.map((message) => ({ role: message.role, content: message.text }));
}

export type UserTurn = {
  text: string;
  source: ChatSource;
  clientId?: string;
};

export type TurnNotice = {
  source: ChatSource;
  userText: string;
  assistantText?: string;
  error?: string;
};

export type FinishedTurn = {
  user: ChatMessage;
  assistant: ChatMessage | null;
};

function usageSource(source: ChatSource): UsageSource {
  if (source === "system") {
    return "cron";
  }
  return source;
}

function withTimeout(llm: LlmClient, timeoutMs: number): LlmClient {
  return {
    async complete(input) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          llm.complete(input),
          new Promise<LlmResult>(
            (_resolve, reject) => {
              timer = setTimeout(() => {
                const error = new Error("timeout");
                error.name = "TimeoutError";
                reject(error);
              }, timeoutMs);
            },
          ),
        ]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    },
  };
}

export function createMessageHandler(options: {
  llm: LlmClient;
  systemPrompt: string;
  tasks: TaskService;
  transcripts: TranscriptService;
  notes?: NoteService;
  messages: MessageStore;
  events: EventBus;
  timeZone?: string;
  now?: () => Date;
  timeoutMs?: number;
  onTurn?: (turn: TurnNotice) => void | Promise<unknown>;
}) {
  const tools = createBotTools(options.tasks, options.transcripts, options.notes);
  const llm = withTimeout(options.llm, options.timeoutMs ?? 60_000);
  let chain = Promise.resolve();

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function notify(turn: TurnNotice): void {
    if (!options.onTurn) {
      return;
    }
    void Promise.resolve(options.onTurn(turn)).catch((error: unknown) => {
      logError("Nebenwirkung der Antwort fehlgeschlagen", error);
    });
  }

  async function handleUserMessage(input: UserTurn): Promise<{
    message: ChatMessage;
    duplicate: boolean;
    done: Promise<FinishedTurn>;
  }> {
    const text = input.text ?? "";
    if (input.clientId) {
      const existing = await options.messages.findByClientId(input.clientId);
      if (existing) {
        return {
          message: existing,
          duplicate: true,
          done: Promise.resolve({ user: existing, assistant: null }),
        };
      }
    }
    const stored = await options.messages.append({
      ...(input.clientId ? { clientId: input.clientId } : {}),
      source: input.source,
      role: "user",
      text,
      status: "pending",
    });
    if (!stored.created) {
      return {
        message: stored.message,
        duplicate: true,
        done: Promise.resolve({ user: stored.message, assistant: null }),
      };
    }
    options.events.emit({ type: "message:new", message: stored.message });

    const done = enqueue(async () => {
      try {
        const history = await options.messages.list({ limit: 80 });
        const prior = toContext(history.filter((message) => message.id !== stored.message.id));
        const reply = await chatWithTools({
          llm,
          systemPrompt: options.systemPrompt,
          userText: stored.message.text,
          tools: tools.definitions,
          execute: tools.execute,
          timeZone: options.timeZone,
          now: options.now?.(),
          prior,
          source: usageSource(input.source),
        });
        const savedUser = await options.messages.updateStatus(stored.message.id, "done");
        options.events.emit({ type: "message:updated", message: savedUser });
        const assistant = await options.messages.append({
          source: input.source,
          role: "assistant",
          text: reply,
          status: "done",
        });
        options.events.emit({ type: "message:new", message: assistant.message });
        notify({ source: input.source, userText: stored.message.text, assistantText: reply });
        return { user: savedUser, assistant: assistant.message };
      } catch (error) {
        const failure = germanLlmError(error);
        const failed = await options.messages.updateStatus(
          stored.message.id,
          "error",
          failure.message,
        );
        options.events.emit({ type: "message:updated", message: failed });
        notify({ source: input.source, userText: stored.message.text, error: failure.message });
        return { user: failed, assistant: null };
      }
    });

    return { message: stored.message, duplicate: false, done };
  }

  async function recordSystem(text: string): Promise<ChatMessage> {
    const stored = await options.messages.append({
      source: "system",
      role: "assistant",
      text,
      status: "done",
    });
    options.events.emit({ type: "message:new", message: stored.message });
    return stored.message;
  }

  return { handleUserMessage, recordSystem };
}

export type MessageHandler = ReturnType<typeof createMessageHandler>;
