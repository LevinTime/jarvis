import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEventBus } from "../src/events.ts";
import { createMessageStore } from "../src/messages/store.ts";
import { createNoteService } from "../src/notes/service.ts";
import { createSettingsStore, settingsPath } from "../src/settings/store.ts";
import { createTaskService } from "../src/tasks/service.ts";
import { createWebApp, startWebServer } from "../src/web/server.ts";

const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-e2e-"));
const tasks = createTaskService({ dataDir, now: () => new Date("2026-10-19T09:30:00+02:00") });
const notes = createNoteService({ dataDir });
const messages = createMessageStore({ dataDir });
const settings = createSettingsStore({
  file: settingsPath(dataDir),
  defaultT3Url: "http://127.0.0.1:9",
});
const app = createWebApp({
  tasks,
  notes,
  messages,
  events: createEventBus(),
  settings,
  t3Url: "http://127.0.0.1:9",
  now: () => new Date("2026-10-19T09:30:00+02:00"),
  frontendDist: path.resolve("web/dist"),
  reply: async (message) => message,
  chat: {
    async handleUserMessage(input) {
      const stored = await messages.append({
        source: "web",
        role: "user",
        text: input.text,
        status: "done",
      });
      return {
        message: stored.message,
        duplicate: !stored.created,
        done: Promise.resolve({ user: stored.message, assistant: null }),
      };
    },
  },
});

const started = await startWebServer(app, { port: 4173 });
console.log(`jarvis e2e http://${started.host}:${started.port}`);
