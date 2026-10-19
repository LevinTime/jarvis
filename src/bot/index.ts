import path from "node:path";
import { loadEnv, MissingConfigError, projectRoot, requireEnv } from "../load-env.ts";
import { logErrorSync } from "../log.ts";
import { readBudget, createRuntime } from "../runtime.ts";

async function main(): Promise<void> {
  loadEnv();
  const env = requireEnv(["GROK_API_KEY", "TELEGRAM_BOT_TOKEN", "ALLOWED_CHAT_ID"]);
  const dataDir = process.env.JARVIS_DATA_DIR ?? path.join(projectRoot, "data");
  const transcriptsDir =
    process.env.JARVIS_TRANSCRIPTS_DIR ?? path.join(projectRoot, "transcripts");
  const runtime = await createRuntime({
    dataDir,
    transcriptsDir,
    timeZone: process.env.TZ,
    apiKey: env.GROK_API_KEY,
    model: process.env.GROK_MODEL,
    telegramToken: env.TELEGRAM_BOT_TOKEN,
    allowedChatId: env.ALLOWED_CHAT_ID,
    budgetUsd: readBudget(process.env.JARVIS_MONTHLY_BUDGET_USD),
    reasoningEffort: process.env.GROK_REASONING_EFFORT,
    maxTokens: process.env.GROK_MAX_TOKENS,
  });
  await runtime.startTelegram();
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
