import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createEventBus } from "../src/events.ts";
import { createMessageStore } from "../src/messages/store.ts";
import { createNoteService } from "../src/notes/service.ts";
import { DEFAULT_SETTINGS, DEFAULT_T3_URL, normalizeSettings, readDefaultT3Url } from "../src/settings/model.ts";
import { createSettingsStore, settingsPath } from "../src/settings/store.ts";
import { createTaskService } from "../src/tasks/service.ts";
import { createWebApp, startWebServer, WEB_HOST } from "../src/web/server.ts";

const NOW = () => new Date("2026-10-19T09:30:00+02:00");

async function withSettings(options: { store?: boolean; t3Url?: string } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-settings-"));
  const tasks = createTaskService({ dataDir, now: NOW });
  const notes = createNoteService({ dataDir });
  const messages = createMessageStore({ dataDir });
  const settings = options.store
    ? createSettingsStore({ file: settingsPath(dataDir), ...(options.t3Url ? { defaultT3Url: options.t3Url } : {}) })
    : undefined;
  const app = createWebApp({
    tasks,
    notes,
    messages,
    events: createEventBus(),
    now: NOW,
    ...(settings ? { settings } : {}),
    ...(options.t3Url ? { t3Url: options.t3Url } : {}),
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
  const started = await startWebServer(app, { port: 0 });
  return {
    dataDir,
    base: `http://${WEB_HOST}:${started.port}`,
    async close() {
      await started.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("settings defaults clamp scales and reject bad T3 addresses", () => {
  assert.equal(DEFAULT_T3_URL, "https://levin.tail34013b.ts.net:8443");
  assert.equal(readDefaultT3Url(undefined), DEFAULT_T3_URL);
  assert.equal(readDefaultT3Url("http://127.0.0.1:4555"), "http://127.0.0.1:4555");
  assert.equal(readDefaultT3Url("ftp://nope"), DEFAULT_T3_URL);
  assert.equal(readDefaultT3Url("http://user:secret@127.0.0.1:3773"), DEFAULT_T3_URL);
  const next = normalizeSettings({ textScale: 9, radius: 0.1, theme: "ocean" });
  assert.equal(next.textScale, 1.3);
  assert.equal(next.radius, 0.7);
  assert.equal(next.theme, "ocean");
  assert.equal(next.locale, "de");
  assert.throws(() => normalizeSettings({ t3Url: "not a url" }), /T3-Adresse/);
  assert.throws(() => normalizeSettings({ widgets: [{ id: "a", kind: "clock", size: "m" }, { id: "a", kind: "t3", size: "s" }] }), /Widget-Id/);
});

test("settings API stores the layout and keeps JARVIS_T3_URL as the fallback", async () => {
  const api = await withSettings({ store: true, t3Url: "http://127.0.0.1:4555" });
  try {
    const first = await fetch(`${api.base}/api/settings`);
    assert.equal(first.status, 200);
    const opened = (await first.json()) as {
      settings: { theme: string; t3Url: string; widgets: Array<{ id: string }> };
      effectiveT3Url: string;
      defaultT3Url: string;
    };
    assert.equal(opened.defaultT3Url, "http://127.0.0.1:4555");
    assert.equal(opened.effectiveT3Url, "http://127.0.0.1:4555");
    assert.equal(opened.settings.t3Url, "");
    assert.equal(opened.settings.widgets.length, DEFAULT_SETTINGS.widgets.length);

    const saved = await fetch(`${api.base}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        settings: {
          theme: "aurora",
          locale: "en",
          widgets: [{ id: "clock", kind: "clock", size: "l" }],
          t3Url: "https://t3.example.ts.net",
        },
      }),
    });
    assert.equal(saved.status, 200);
    const body = (await saved.json()) as {
      settings: { theme: string; locale: string; widgets: Array<{ size: string }> };
      effectiveT3Url: string;
    };
    assert.equal(body.settings.theme, "aurora");
    assert.equal(body.settings.locale, "en");
    assert.equal(body.settings.widgets[0]?.size, "l");
    assert.equal(body.effectiveT3Url, "https://t3.example.ts.net");

    const cleared = await fetch(`${api.base}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { t3Url: "" } }),
    });
    assert.equal(cleared.status, 200);
    const again = (await cleared.json()) as { effectiveT3Url: string; settings: { theme: string } };
    assert.equal(again.effectiveT3Url, "http://127.0.0.1:4555");
    assert.equal(again.settings.theme, "aurora");

    const rejected = await fetch(`${api.base}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { t3Url: "http://user:secret@127.0.0.1:3773" } }),
    });
    assert.equal(rejected.status, 400);
    const rejectedText = await rejected.text();
    assert.equal(rejectedText.includes("secret"), false);
    const disk = await readFile(path.join(api.dataDir, "settings.json"), "utf8");
    assert.match(disk, /aurora/);
    assert.equal(disk.includes("secret"), false);
  } finally {
    await api.close();
  }
});

test("settings without a store stay read-only and an unreachable T3 stays down", async () => {
  const readonly = await withSettings({ t3Url: "http://127.0.0.1:1" });
  try {
    const opened = await fetch(`${readonly.base}/api/settings`);
    assert.equal(opened.status, 200);
    const body = (await opened.json()) as { defaultT3Url: string; effectiveT3Url: string };
    assert.equal(body.defaultT3Url, "http://127.0.0.1:1");
    assert.equal(body.effectiveT3Url, "http://127.0.0.1:1");
    const denied = await fetch(`${readonly.base}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ settings: { theme: "light" } }),
    });
    assert.equal(denied.status, 501);
    const probe = await fetch(`${readonly.base}/api/t3`);
    assert.equal(probe.status, 200);
    const t3 = (await probe.json()) as { reachable: boolean; url: string };
    assert.equal(t3.reachable, false);
    assert.equal(t3.url, "http://127.0.0.1:1");
  } finally {
    await readonly.close();
  }
});
