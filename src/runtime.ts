import { readFileSync } from "node:fs";
import path from "node:path";
import { createMessageHandler } from "./assistant.ts";
import {
  canMirror,
  createTelegramBot,
  formatAufgaben,
  mirrorWebTurn,
  numericChatId,
  splitTelegramText,
} from "./bot/telegram.ts";
import { startReminders } from "./bot/reminders.ts";
import { createEventBus, type EventBus } from "./events.ts";
import {
  createGrokClient,
  DEFAULT_GROK_MODEL,
  loadSystemPrompt,
  readMaxTokens,
  readReasoningEffort,
} from "./llm.ts";
import { projectRoot } from "./load-env.ts";
import { logError, logInfo } from "./log.ts";
import { createMessageStore, type MessageStore } from "./messages/store.ts";
import { createNoteService, type NoteService } from "./notes/service.ts";
import { observeNotes, observeTasks } from "./observe.ts";
import { createTaskService, type TaskService } from "./tasks/service.ts";
import { createTranscriptService, type TranscriptService } from "./transcripts/service.ts";
import { budgetNotice, type BudgetLevel } from "./usage/cost.ts";
import { createUsageStore, type UsageStore } from "./usage/store.ts";
import type { UsageNotice } from "./usage/types.ts";
import { createSettingsStore, settingsPath } from "./settings/store.ts";
import { checkT3Url, DEFAULT_T3_URL } from "./settings/model.ts";
import { createWebApp, type WebAppOptions } from "./web/server.ts";
import type { LlmClient } from "./bot/tools.ts";
import { germanLlmError } from "./llm-error.ts";

export const DEFAULT_MONTHLY_BUDGET_USD = 15;

export function readBudget(raw: string | undefined): number | null {
  const text = raw?.trim() ?? "";
  if (!text) {
    return DEFAULT_MONTHLY_BUDGET_USD;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    logInfo(`JARVIS_MONTHLY_BUDGET_USD ist ungültig. Es gilt ${DEFAULT_MONTHLY_BUDGET_USD}.`);
    return DEFAULT_MONTHLY_BUDGET_USD;
  }
  if (value === 0) {
    return null;
  }
  return value;
}

export function readWebPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.JARVIS_WEB_PORT?.trim() || env.PORT?.trim() || "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`JARVIS_WEB_PORT ist ungültig: ${raw}`);
  }
  return port;
}

function packageVersion(): string {
  try {
    const raw = readFileSync(path.join(projectRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function missingKeyLlm(): LlmClient {
  return {
    async complete() {
      throw Object.assign(
        new Error("GROK_API_KEY fehlt in .env. Trag den Wert ein (Vorlage: config/.env.example)."),
        { code: "missing_key" },
      );
    },
  };
}

export async function createRuntime(options: {
  dataDir: string;
  transcriptsDir: string;
  timeZone?: string;
  apiKey?: string;
  model?: string;
  telegramToken?: string;
  allowedChatId?: string;
  budgetUsd?: number | null;
  reasoningEffort?: string;
  maxTokens?: string;
  allowedTsUser?: string;
  version?: string;
  frontendDist?: string;
  t3Url?: string;
}) {
  const timeZone = options.timeZone?.trim() || "Europe/Berlin";
  if (options.allowedTsUser?.trim()) {
    logInfo("JARVIS_ALLOWED_TS_USER ist gesetzt. Lokal ohne Header bleibt erlaubt.");
  }
  const events: EventBus = createEventBus();
  const messages: MessageStore = createMessageStore({ dataDir: options.dataDir });
  const usage: UsageStore = createUsageStore({
    dataDir: options.dataDir,
    timeZone,
    budgetUsd: options.budgetUsd ?? null,
  });
  await messages.recoverPending();

  let lastLlmError: string | undefined;
  const apiKey = options.apiKey?.trim() ?? "";
  let toldApp: BudgetLevel = "none";
  let toldTelegram: BudgetLevel = "none";
  let considerBudget = async (): Promise<void> => {};

  const llm = apiKey
    ? createGrokClient({
        apiKey,
        model: options.model?.trim() || DEFAULT_GROK_MODEL,
        reasoningEffort: readReasoningEffort(options.reasoningEffort),
        maxTokens: readMaxTokens(options.maxTokens),
        onUsage: async (notice: UsageNotice) => {
          lastLlmError = notice.ok ? undefined : germanLlmError({ code: notice.error ?? "llm_error" }).message;
          const entry = await usage.append(notice);
          events.emit({ type: "usage:new", entry });
          try {
            await considerBudget();
          } catch (error) {
            logError("Budget-Hinweis fehlgeschlagen", error);
          }
        },
      })
    : missingKeyLlm();

  const tasks: TaskService = observeTasks(
    createTaskService({ dataDir: options.dataDir, timeZone }),
    events,
  );
  const notes: NoteService = observeNotes(createNoteService({ dataDir: options.dataDir }), events);
  const transcripts: TranscriptService = createTranscriptService({
    transcriptsDir: options.transcriptsDir,
  });
  await tasks.recoverStale();

  const token = options.telegramToken?.trim() ?? "";
  const allowedChatId = options.allowedChatId?.trim() ?? "";
  const mirror = Boolean(token) && canMirror(allowedChatId);
  const telegram = { configured: Boolean(token), connected: false, mirror };
  let bot: ReturnType<typeof createTelegramBot> | null = null;
  let reminders: { stop: () => void } | null = null;

  const providedT3 = options.t3Url?.trim() ?? "";
  let defaultT3Url = DEFAULT_T3_URL;
  if (providedT3) {
    try {
      defaultT3Url = checkT3Url(providedT3) || DEFAULT_T3_URL;
    } catch {
      logInfo("JARVIS_T3_URL ist ungültig. Es gilt die lokale T3-Adresse.");
    }
  }
  const settings = createSettingsStore({
    file: settingsPath(options.dataDir),
    defaultT3Url,
  });

  const handler = createMessageHandler({
    llm,
    systemPrompt: await loadSystemPrompt(),
    tasks,
    notes,
    transcripts,
    messages,
    events,
    timeZone,
    replyLanguage: async () => (await settings.get()).assistantLanguage,
    onTurn: (turn) => {
      if (turn.source !== "web" || !bot || !mirror) {
        return;
      }
      const chatId = numericChatId(allowedChatId);
      return mirrorWebTurn({
        userText: turn.userText,
        assistantText: turn.assistantText,
        send: async (text, sendOptions) => {
          await bot!.api.sendMessage(
            chatId,
            text,
            sendOptions?.parseMode ? { parse_mode: sendOptions.parseMode } : {},
          );
        },
      });
    },
  });

  if (token) {
    bot = createTelegramBot({
      token,
      allowedChatId,
      handleText: async (text) => {
        const turn = await handler.handleUserMessage({ text, source: "telegram" });
        const finished = await turn.done;
        if (finished.user.status === "error") {
          return finished.user.error ?? "Da ist etwas schiefgegangen.";
        }
        return finished.assistant?.text ?? "Ich habe gerade keine Antwort.";
      },
      listAufgaben: async () => formatAufgaben(await tasks.list()),
      erledigt: async (id) => {
        try {
          const task = await tasks.run(id);
          return `erledigt  ${task.id}  ${task.titel}`;
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      },
    });
  }

  const webOptions: WebAppOptions = {
    tasks,
    notes,
    messages,
    events,
    usage,
    chat: handler,
    version: options.version ?? packageVersion(),
    timeZone,
    telegram,
    llm: {
      configured: Boolean(apiKey),
      lastError: () => lastLlmError,
    },
    ...(options.allowedTsUser?.trim()
      ? { allowedTsUser: options.allowedTsUser.trim() }
      : {}),
    ...(options.frontendDist ? { frontendDist: options.frontendDist } : {}),
    settings,
    t3Url: defaultT3Url,
    reply: async (message) => {
      const turn = await handler.handleUserMessage({ text: message, source: "web" });
      const finished = await turn.done;
      if (finished.user.status === "error") {
        return finished.user.error ?? "Da ist etwas schiefgegangen.";
      }
      return finished.assistant?.text ?? "Ich habe gerade keine Antwort.";
    },
  };
  const app = createWebApp(webOptions);

  function publishStatus(): void {
    events.emit({
      type: "status:changed",
      telegramConnected: telegram.connected,
      llmConfigured: Boolean(apiKey),
    });
  }

  function startReminderLoop(): void {
    if (!bot || reminders) {
      return;
    }
    const current = bot;
    reminders = startReminders({
      tasks,
      notes,
      dataDir: options.dataDir,
      timeZone,
      send: async (text) => {
        try {
          await handler.recordSystem(text);
        } catch (error) {
          logError("Systemnachricht nicht gespeichert", error);
        }
        const chatId = numericChatId(allowedChatId);
        for (const part of splitTelegramText(text)) {
          await current.api.sendMessage(chatId, part);
        }
      },
    });
  }

  async function startTelegram(): Promise<void> {
    if (!bot) {
      logInfo("TELEGRAM_BOT_TOKEN fehlt. Telegram ist nicht verbunden.");
      return;
    }
    if (!mirror) {
      logInfo("ALLOWED_CHAT_ID fehlt oder ist 0. Telegram-Spiegelung ist aus.");
    }
    await bot.start({
      onStart: (info) => {
        telegram.connected = true;
        logInfo(`Telegram verbunden${info.username ? ` als @${info.username}` : ""}.`);
        publishStatus();
        startReminderLoop();
        void considerBudget().catch((error: unknown) => {
          logError("Budget-Hinweis fehlgeschlagen", error);
        });
      },
    });
  }

  considerBudget = async () => {
    const report = await usage.report("month");
    const level = report.budget.level;
    if (level !== "warn" && level !== "over") {
      toldApp = level;
      toldTelegram = level;
      return;
    }
    const limit = report.budget.limitUsd ?? 0;
    const text = budgetNotice(level, report.budget.spentUsd, limit);
    if (!text) {
      return;
    }
    if (toldApp !== level && toldApp !== "over") {
      try {
        await handler.recordSystem(text);
        toldApp = level;
        logInfo(text);
      } catch (error) {
        logError("Budget-Hinweis nicht gespeichert", error);
      }
    }
    if (!bot || !mirror || toldTelegram === level || toldTelegram === "over") {
      return;
    }
    try {
      const chatId = numericChatId(allowedChatId);
      for (const part of splitTelegramText(text)) {
        await bot.api.sendMessage(chatId, part);
      }
      toldTelegram = level;
    } catch (error) {
      logError("Budget-Hinweis an Telegram fehlgeschlagen", error);
    }
  };
  await considerBudget();

  async function shutdown(): Promise<void> {
    reminders?.stop();
    events.close();
    if (bot) {
      await bot.stop().catch((error: unknown) => {
        logError("Telegram-Bot ließ sich nicht stoppen", error);
      });
    }
    await messages.drain();
    await usage.drain();
  }

  if (!apiKey) {
    logError("GROK_API_KEY fehlt in .env. Trag den Wert ein (Vorlage: config/.env.example).");
  }

  return {
    app,
    events,
    messages,
    tasks,
    notes,
    usage,
    startTelegram,
    shutdown,
    telegramConnected: () => telegram.connected,
  };
}

export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
