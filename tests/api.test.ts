import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createEventBus } from "../src/events.ts";
import { createMessageStore } from "../src/messages/store.ts";
import { createNoteService } from "../src/notes/service.ts";
import { createTaskService } from "../src/tasks/service.ts";
import { originAllowed, tailscaleAllowed } from "../src/web/security.ts";
import { createWebApp, startWebServer, WEB_HOST } from "../src/web/server.ts";

async function withApi(extra: { frontendDist?: string; allowedTsUser?: string } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-api-"));
  const tasks = createTaskService({ dataDir, now: () => new Date("2026-10-17T12:00:00+02:00") });
  const notes = createNoteService({ dataDir });
  const messages = createMessageStore({ dataDir });
  const events = createEventBus();
  const app = createWebApp({
    tasks,
    notes,
    messages,
    events,
    now: () => new Date("2026-10-17T12:00:00+02:00"),
    reply: async (message) => `Echo: ${message}`,
    chat: {
      async handleUserMessage(input) {
        const stored = await messages.append({
          ...(input.clientId ? { clientId: input.clientId } : {}),
          source: "web",
          role: "user",
          text: input.text,
          status: "pending",
        });
        events.emit({ type: "message:new", message: stored.message });
        return { message: stored.message, duplicate: !stored.created, done: Promise.resolve({ user: stored.message, assistant: null }) };
      },
    },
    ...extra,
  });
  const started = await startWebServer(app, { port: 0 });
  return {
    tasks,
    notes,
    base: `http://${WEB_HOST}:${started.port}`,
    async cleanup() {
      await started.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("new task routes validate, update, delete and keep the legacy chat", async () => {
  const api = await withApi();
  try {
    const missing = await fetch(`${api.base}/api/does-not-exist`);
    assert.equal(missing.status, 404);
    const missingBody = (await missing.json()) as { error: { code: string } };
    assert.equal(missingBody.error.code, "not_found");

    const bad = await fetch(`${api.base}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titel: "" }),
    });
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "invalid");

    const created = await fetch(`${api.base}/api/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        titel: "Hühner",
        aufgabe: "füttern",
        faelligAm: "2026-10-25T18:00",
        wiederholung: "taeglich",
      }),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { task: { id: string; faelligAm: string } };
    assert.equal(createdBody.task.faelligAm, "2026-10-25T18:00:00+01:00");

    const patched = await fetch(`${api.base}/api/tasks/${createdBody.task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "erledigt" }),
    });
    assert.equal(patched.status, 200);
    const open = (await api.tasks.list()).find((task) => task.status === "offen");
    assert.equal(open?.faelligAm, "2026-10-26T18:00:00+01:00");

    const removed = await fetch(`${api.base}/api/tasks/${open?.id}`, { method: "DELETE" });
    assert.equal(removed.status, 200);

    const legacy = await fetch(`${api.base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Whirlpool" }),
    });
    assert.equal(legacy.status, 200);
    assert.equal(((await legacy.json()) as { reply: string }).reply, "Echo: Whirlpool");

    const evil = await fetch(`${api.base}/api/tasks`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ titel: "nein", aufgabe: "nein" }),
    });
    assert.equal(evil.status, 403);
  } finally {
    await api.cleanup();
  }
});

test("tailscale header and origin rules allow localhost and reject a stranger", async () => {
  assert.equal(originAllowed("https://evil.example", "127.0.0.1:3000"), false);
  assert.equal(originAllowed("http://127.0.0.1:3000", "127.0.0.1:3000"), true);
  assert.equal(tailscaleAllowed({ allowedUser: "levin", remote: "1.2.3.4" }), false);
  assert.equal(tailscaleAllowed({ allowedUser: "levin", remote: "127.0.0.1" }), true);
  assert.equal(
    tailscaleAllowed({ allowedUser: "levin", header: "other", remote: "127.0.0.1" }),
    false,
  );

  const api = await withApi({ allowedTsUser: "levin" });
  try {
    const open = await fetch(`${api.base}/api/status`);
    assert.equal(open.status, 200);
    const wrong = await fetch(`${api.base}/api/status`, {
      headers: { "tailscale-user-login": "other" },
    });
    assert.equal(wrong.status, 403);
    const right = await fetch(`${api.base}/api/status`, {
      headers: { "tailscale-user-login": "levin" },
    });
    assert.equal(right.status, 200);
  } finally {
    await api.cleanup();
  }
});

test("spa fallback serves index.html and a missing build shows the hint", async () => {
  const dist = await mkdtemp(path.join(tmpdir(), "jarvis-dist-"));
  const empty = await mkdtemp(path.join(tmpdir(), "jarvis-dist-empty-"));
  await writeFile(path.join(dist, "index.html"), "<!doctype html><title>APP_SHELL</title>", "utf8");
  const ready = await withApi({ frontendDist: dist });
  const missing = await withApi({ frontendDist: empty });
  try {
    const home = await fetch(`${ready.base}/`);
    assert.match(await home.text(), /APP_SHELL/);
    const deep = await fetch(`${ready.base}/kalender`);
    assert.match(await deep.text(), /APP_SHELL/);
    const apiMiss = await fetch(`${ready.base}/api/nope`);
    assert.equal(apiMiss.status, 404);
    const hint = await fetch(`${missing.base}/`);
    const html = await hint.text();
    assert.match(html, /Frontend nicht gebaut/);
    assert.match(html, /npm run web:build/);
  } finally {
    await ready.cleanup();
    await missing.cleanup();
    await rm(dist, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
});

test("calendar and messages endpoints return Berlin occurrences and pages", async () => {
  const api = await withApi();
  try {
    await api.tasks.create({
      id: "futter",
      titel: "Hühner",
      aufgabe: "füttern",
      faelligAm: "2026-10-24T18:00:00+02:00",
      wiederholung: "taeglich",
    });
    const calendar = await fetch(
      `${api.base}/api/calendar?from=2026-10-24T00:00:00%2B02:00&to=2026-10-26T00:00:00%2B01:00`,
    );
    assert.equal(calendar.status, 200);
    const body = (await calendar.json()) as { items: Array<{ faelligAm: string }> };
    assert.deepEqual(
      body.items.map((item) => item.faelligAm),
      ["2026-10-24T18:00:00+02:00", "2026-10-25T18:00:00+01:00"],
    );

    const posted = await fetch(`${api.base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hallo App", clientId: "c1" }),
    });
    assert.equal(posted.status, 202);
    const again = await fetch(`${api.base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Hallo App", clientId: "c1" }),
    });
    const second = (await again.json()) as { duplicate: boolean };
    assert.equal(second.duplicate, true);
    const listed = await fetch(`${api.base}/api/messages?limit=10`);
    const messages = (await listed.json()) as { messages: Array<{ text: string }> };
    assert.equal(messages.messages.length, 1);
  } finally {
    await api.cleanup();
  }
});
