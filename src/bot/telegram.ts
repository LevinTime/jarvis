import { Bot } from "grammy";
import type { Task } from "../tasks/service.ts";

const TELEGRAM_LIMIT = 4096;

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
    await ctx.reply(telegramText(await options.listAufgaben()));
  });

  bot.command("erledigt", async (ctx) => {
    const id = ctx.match?.toString().trim() ?? "";
    if (!id) {
      await ctx.reply("erledigt braucht eine id, z. B. /erledigt abc");
      return;
    }
    await ctx.reply(telegramText(await options.erledigt(id)));
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      return;
    }
    try {
      await ctx.reply(telegramText(await options.handleText(text)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(`Da ist etwas schiefgegangen: ${message}`);
    }
  });

  return bot;
}
