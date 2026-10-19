import path from "node:path";
import { loadEnv, projectRoot } from "../load-env.ts";
import { logInfo } from "../log.ts";
import { createRuntime, readBudget, readWebPort } from "../runtime.ts";
import { startWebServer } from "./server.ts";

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
  budgetUsd: readBudget(process.env.JARVIS_MONTHLY_BUDGET_USD),
  allowedTsUser: process.env.JARVIS_ALLOWED_TS_USER,
  frontendDist: path.join(projectRoot, "web", "dist"),
});
const app = runtime.app;
const started = await startWebServer(app, { port: readWebPort() });
logInfo(`Jarvis-Web läuft auf http://${started.host}:${started.port}`);
logInfo("Telegram nicht verbunden. Für Bot und Web zusammen: npm start");

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) {
    return;
  }
  closing = true;
  await runtime.shutdown();
  await started.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
