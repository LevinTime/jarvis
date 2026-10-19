import path from "node:path";
import { loadEnv, projectRoot } from "./load-env.ts";
import { logError, logErrorSync, logInfo } from "./log.ts";
import { createRuntime, readBudget, readWebPort } from "./runtime.ts";
import { startWebServer } from "./web/server.ts";

export async function startJarvis(): Promise<void> {
  loadEnv();
  const dataDir = process.env.JARVIS_DATA_DIR ?? path.join(projectRoot, "data");
  const transcriptsDir =
    process.env.JARVIS_TRANSCRIPTS_DIR ?? path.join(projectRoot, "transcripts");
  const runtime = await createRuntime({
    dataDir,
    transcriptsDir,
    timeZone: process.env.TZ,
    apiKey: process.env.GROK_API_KEY,
    model: process.env.GROK_MODEL,
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
    allowedChatId: process.env.ALLOWED_CHAT_ID,
    budgetUsd: readBudget(process.env.JARVIS_MONTHLY_BUDGET_USD),
    reasoningEffort: process.env.GROK_REASONING_EFFORT,
    maxTokens: process.env.GROK_MAX_TOKENS,
    allowedTsUser: process.env.JARVIS_ALLOWED_TS_USER,
    frontendDist: path.join(projectRoot, "web", "dist"),
    t3Url: process.env.JARVIS_T3_URL,
  });
  const started = await startWebServer(runtime.app, { port: readWebPort() });
  logInfo(`Jarvis läuft auf http://${started.host}:${started.port}`);

  void runtime.startTelegram().catch((error: unknown) => {
    logError("Telegram-Bot nicht gestartet", error);
  });

  let closing = false;
  const shutdown = async () => {
    if (closing) {
      return;
    }
    closing = true;
    logInfo("Jarvis fährt herunter.");
    await runtime.shutdown();
    await started.close();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (entry?.endsWith("/main.ts") || entry?.endsWith("/main.js")) {
  startJarvis().catch((error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    logErrorSync(`Jarvis abgebrochen: ${detail}`);
    process.exit(1);
  });
}
