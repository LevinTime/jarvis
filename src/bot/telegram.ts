import { Bot } from "grammy";
import { logError } from "../log.ts";
import type { Task } from "../tasks/service.ts";

const TELEGRAM_LIMIT = 4096;
const MARKDOWN_V2 = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function splitTelegramText(text: string, limit = TELEGRAM_LIMIT): string[] {
  if (text.length <= limit) {
    return [text];
  }
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < Math.floor(limit / 2)) {
      cut = limit;
    }
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest.length > 0) {
    parts.push(rest);
  }
  return parts;
}

export function escapeMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2, "\\$&");
}

export function isMirroredWebMessage(text: string): boolean {
  return text.startsWith("🖥 Web:");
}

export function formatWebMirror(text: string): string {
  return `🖥 Web: ${text}`;
}

export function canMirror(allowedChatId: string | undefined): boolean {
  const value = allowedChatId?.trim() ?? "";
  return value.length > 0 && value !== "0";
}

export type TelegramSend = (
  text: string,
  options?: { parseMode?: "MarkdownV2" },
) => Promise<void>;

function retryAfterSeconds(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const direct = error as {
    error_code?: number;
    parameters?: { retry_after?: number };
    error?: { error_code?: number; parameters?: { retry_after?: number } };
  };
  const fromParameters = direct.parameters?.retry_after ?? direct.error?.parameters?.retry_after;
  if (typeof fromParameters === "number" && Number.isFinite(fromParameters)) {
    return fromParameters;
  }
  const message = error instanceof Error ? error.message : "";
  const match = /retry after (\d+)/i.exec(message);
  return match?.[1] ? Number(match[1]) : undefined;
}

function isRetryable(error: unknown): boolean {
  if (retryAfterSeconds(error) !== undefined) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { error_code?: number; code?: string; error?: { error_code?: number } };
  if (record.error_code === 429 || record.error?.error_code === 429) {
    return true;
  }
  return record.code === "ECONNRESET" || record.code === "ETIMEDOUT" || record.code === "ECONNREFUSED";
}

function isParseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /parse|markdown/i.test(message);
}

export async function deliverTelegramText(options: {
  text: string;
  send: TelegramSend;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}): Promise<void> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxAttempts = options.maxAttempts ?? 4;
  for (const part of splitTelegramText(options.text)) {
    let plain = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (plain) {
          await options.send(part);
        } else {
          await options.send(escapeMarkdownV2(part), { parseMode: "MarkdownV2" });
        }
        break;
      } catch (error) {
        if (!plain && isParseError(error)) {
          plain = true;
          continue;
        }
        if (!isRetryable(error) || attempt === maxAttempts) {
          throw error;
        }
        const retryAfter = retryAfterSeconds(error);
        const wait = retryAfter !== undefined ? retryAfter * 1000 : 400 * 2 ** (attempt - 1);
        await sleep(wait);
      }
    }
  }
}

export async function mirrorWebTurn(options: {
  userText: string;
  assistantText?: string;
  send: TelegramSend;
  sleep?: (ms: number) => Promise<void>;
}): Promise<{ ok: boolean }> {
  try {
    await deliverTelegramText({
      text: formatWebMirror(options.userText),
      send: options.send,
      sleep: options.sleep,
    });
    if (options.assistantText) {
      await deliverTelegramText({
        text: options.assistantText,
        send: options.send,
        sleep: options.sleep,
      });
    }
    return { ok: true };
  } catch (error) {
    logError("Telegram-Spiegelung fehlgeschlagen", error);
    return { ok: false };
  }
}

async function replyParts(
  reply: (text: string) => Promise<unknown>,
  text: string,
): Promise<void> {
  for (const part of splitTelegramText(text)) {
    await reply(part);
  }
}

export function isAllowedChat(
  chatId: number | string | undefined,
  allowedChatId: string,
): boolean {
  return String(chatId ?? "") === String(allowedChatId);
}

export function telegramText(text: string): string {
  if (text.length <= TELEGRAM_LIMIT) {
    return text;
  }
  return `${text.slice(0, TELEGRAM_LIMIT - 3)}...`;
}

export function formatAufgaben(tasks: Task[]): string {
  if (tasks.length === 0) {
    return "keine Aufgaben";
  }
  return tasks
    .map((task) => {
      const due = task.faelligAm ? `  bis ${task.faelligAm}` : "";
      const repeat = task.wiederholung ? `  ${task.wiederholung}` : "";
      return `${task.id}  ${task.status}  ${task.titel}${due}${repeat}`;
    })
    .join("\n");
}

export function numericChatId(allowedChatId: string): number | string {
  return /^-?\d+$/.test(allowedChatId) ? Number(allowedChatId) : allowedChatId;
}

export function createTelegramBot(options: {
  token: string;
  allowedChatId: string;
  handleText: (text: string) => Promise<string>;
  listAufgaben: () => Promise<string>;
  erledigt: (id: string) => Promise<string>;
}): Bot {
  const bot = new Bot(options.token);

  bot.command("start", async (ctx) => {
    await ctx.reply(`Jarvis hier. Deine Chat-ID: ${ctx.chat.id}`);
  });

  bot.use(async (ctx, next) => {
    if (!isAllowedChat(ctx.chat?.id, options.allowedChatId)) {
      return;
    }
    await next();
  });

  bot.command("aufgaben", async (ctx) => {
    await replyParts((text) => ctx.reply(text), await options.listAufgaben());
  });

  bot.command("erledigt", async (ctx) => {
    const id = ctx.match?.toString().trim() ?? "";
    if (!id) {
      await ctx.reply("erledigt braucht eine id, z. B. /erledigt abc");
      return;
    }
    await replyParts((text) => ctx.reply(text), await options.erledigt(id));
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/") || ctx.from?.is_bot || isMirroredWebMessage(text)) {
      return;
    }
    try {
      await replyParts((part) => ctx.reply(part), await options.handleText(text));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(`Da ist etwas schiefgegangen: ${message}`);
    }
  });

  return bot;
}
