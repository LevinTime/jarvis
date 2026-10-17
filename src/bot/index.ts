import path from "node:path";
import { loadEnv, projectRoot } from "../load-env.ts";
import { createTaskService } from "../tasks/service.ts";
import { createTranscriptService } from "../transcripts/service.ts";
import { createGrokClient, loadSystemPrompt } from "../llm.ts";
import { chatWithTools, createBotTools } from "./tools.ts";
import {
  createTelegramBot,
  formatAufgaben,
  numericChatId,
} from "./telegram.ts";
import { startReminders } from "./reminders.ts";

loadEnv();

function required(name: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    throw new Error(`${name} fehlt in .env`);
  }
  return value;
}

const dataDir = process.env.JARVIS_DATA_DIR ?? path.join(projectRoot, "data");
const transcriptsDir =
  process.env.JARVIS_TRANSCRIPTS_DIR ?? path.join(projectRoot, "transcripts");
const timeZone = process.env.TZ?.trim() || "Europe/Berlin";
const allowedChatId = required("ALLOWED_CHAT_ID");
const chatId = numericChatId(allowedChatId);

const tasks = createTaskService({ dataDir });
const transcripts = createTranscriptService({ transcriptsDir });
await tasks.recoverStale();

const llm = createGrokClient({
  apiKey: required("GROK_API_KEY"),
  model: process.env.GROK_MODEL?.trim() || "grok-4",
});
const systemPrompt = await loadSystemPrompt();
const tools = createBotTools(tasks, transcripts);

const bot = createTelegramBot({
  token: required("TELEGRAM_BOT_TOKEN"),
  allowedChatId,
  handleText: (text) =>
    chatWithTools({
      llm,
      systemPrompt,
      userText: text,
      tools: tools.definitions,
      execute: tools.execute,
      timeZone,
    }),
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

startReminders({
  tasks,
  dataDir,
  timeZone,
  send: async (text) => {
    await bot.api.sendMessage(chatId, text);
  },
});

console.log("Jarvis-Bot läuft.");
await bot.start();
