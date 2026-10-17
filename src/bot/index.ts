import path from "node:path";
import { createAssistant } from "../assistant.ts";
import { createGrokClient, loadSystemPrompt } from "../llm.ts";
import { loadEnv, MissingConfigError, projectRoot, requireEnv } from "../load-env.ts";
import { logErrorSync, logInfo } from "../log.ts";
import { createNoteService } from "../notes/service.ts";
import { createTaskService } from "../tasks/service.ts";
import { createTranscriptService } from "../transcripts/service.ts";
import { startReminders } from "./reminders.ts";
import {
  createTelegramBot,
  formatAufgaben,
  numericChatId,
} from "./telegram.ts";

async function main(): Promise<void> {
  loadEnv();
  const env = requireEnv(["GROK_API_KEY", "TELEGRAM_BOT_TOKEN", "ALLOWED_CHAT_ID"]);
  const dataDir = process.env.JARVIS_DATA_DIR ?? path.join(projectRoot, "data");
  const transcriptsDir =
    process.env.JARVIS_TRANSCRIPTS_DIR ?? path.join(projectRoot, "transcripts");
  const timeZone = process.env.TZ?.trim() || "Europe/Berlin";
  const allowedChatId = env.ALLOWED_CHAT_ID ?? "";
  const chatId = numericChatId(allowedChatId);

  const tasks = createTaskService({ dataDir });
  const notes = createNoteService({ dataDir });
  const transcripts = createTranscriptService({ transcriptsDir });
  await tasks.recoverStale();

  const llm = createGrokClient({
    apiKey: env.GROK_API_KEY ?? "",
    model: process.env.GROK_MODEL?.trim() || "grok-4",
  });
  const systemPrompt = await loadSystemPrompt();
  const assistant = createAssistant({
    llm,
    systemPrompt,
    tasks,
    notes,
    transcripts,
    timeZone,
  });

  const bot = createTelegramBot({
    token: env.TELEGRAM_BOT_TOKEN ?? "",
    allowedChatId,
    handleText: (text) => assistant.reply(text),
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
    notes,
    dataDir,
    timeZone,
    send: async (text) => {
      await bot.api.sendMessage(chatId, text);
    },
  });

  logInfo("Jarvis-Bot läuft.");
  await bot.start();
}

main().catch((error: unknown) => {
  if (error instanceof MissingConfigError) {
    logErrorSync(error.message);
  } else {
    const detail = error instanceof Error ? error.message : String(error);
    logErrorSync(`Jarvis-Bot abgebrochen: ${detail}`);
  }
  process.exit(1);
});
