import path from "node:path";
import { createAssistant } from "../assistant.ts";
import { createGrokClient, loadSystemPrompt } from "../llm.ts";
import { loadEnv, projectRoot } from "../load-env.ts";
import { createNoteService } from "../notes/service.ts";
import { createTaskService } from "../tasks/service.ts";
import { createTranscriptService } from "../transcripts/service.ts";
import { createWebApp, startWebServer } from "./server.ts";

loadEnv();

function webPort(): number {
  const raw = process.env.JARVIS_WEB_PORT?.trim() || process.env.PORT?.trim() || "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`JARVIS_WEB_PORT ist ungültig: ${raw}`);
  }
  return port;
}

const dataDir = process.env.JARVIS_DATA_DIR ?? path.join(projectRoot, "data");
const transcriptsDir =
  process.env.JARVIS_TRANSCRIPTS_DIR ?? path.join(projectRoot, "transcripts");
const timeZone = process.env.TZ?.trim() || "Europe/Berlin";
const apiKey = process.env.GROK_API_KEY?.trim() ?? "";

const tasks = createTaskService({ dataDir });
const notes = createNoteService({ dataDir });
const transcripts = createTranscriptService({ transcriptsDir });
await tasks.recoverStale();

const assistant = apiKey
  ? createAssistant({
      llm: createGrokClient({
        apiKey,
        model: process.env.GROK_MODEL?.trim() || "grok-4",
      }),
      systemPrompt: await loadSystemPrompt(),
      tasks,
      notes,
      transcripts,
      timeZone,
    })
  : null;

const app = createWebApp({
  tasks,
  notes,
  reply: (message) => {
    if (!assistant) {
      return Promise.resolve(
        "GROK_API_KEY fehlt in .env. Aufgaben gehen auch so, der Chat braucht den Key.",
      );
    }
    return assistant.reply(message);
  },
});

const started = await startWebServer(app, { port: webPort() });
console.log(`Jarvis-Web läuft auf http://${started.host}:${started.port}`);
