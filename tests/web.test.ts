import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createTaskService } from "../src/tasks/service.ts";
import { createWebApp, startWebServer, WEB_HOST } from "../src/web/server.ts";

async function withWeb() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-web-"));
  const tasks = createTaskService({ dataDir });
  const seen: string[] = [];
  const app = createWebApp({
    tasks,
    reply: async (message) => {
      seen.push(message);
      return `Echo: ${message}`;
    },
  });
  const started = await startWebServer(app, { port: 0 });
  return {
    tasks,
    dataDir,
    seen,
    base: `http://${WEB_HOST}:${started.port}`,
    host: started.host,
    async cleanup() {
      await started.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("web server binds only to localhost and serves chat plus tasks", async () => {
  const web = await withWeb();
  try {
    assert.equal(web.host, "127.0.0.1");
    const response = await fetch(`${web.base}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Chat/);
    assert.match(html, /Aufgaben/);
    assert.match(html, /id="message"/);
    assert.match(html, /abhaken/);
    assert.match(html, /zurücksetzen/);
  } finally {
    await web.cleanup();
  }
});

test("web lists, completes and resets tasks without calling a model", async () => {
  const web = await withWeb();
  try {
    await web.tasks.create({
      id: "pool",
      titel: "Whirlpool",
      aufgabe: "putzen",
      faelligAm: "2026-10-17T20:00:00+02:00",
    });

    const listed = await fetch(`${web.base}/api/tasks`);
    assert.equal(listed.status, 200);
    const body = (await listed.json()) as { tasks: Array<{ id: string; status: string }> };
    assert.equal(body.tasks[0]?.id, "pool");
    assert.equal(body.tasks[0]?.status, "offen");

    const done = await fetch(`${web.base}/api/tasks/pool/complete`, { method: "POST" });
    assert.equal(done.status, 200);
    const doneBody = (await done.json()) as { task: { status: string } };
    assert.equal(doneBody.task.status, "erledigt");
    assert.equal((await web.tasks.get("pool")).status, "erledigt");

    const conflict = await fetch(`${web.base}/api/tasks/pool/reset`, { method: "POST" });
    assert.equal(conflict.status, 409);

    const startedAt = new Date().toISOString();
    const current = await web.tasks.get("pool");
    await writeFile(
      path.join(web.dataDir, "tasks.json"),
      `${JSON.stringify([{ ...current, status: "in Arbeit", startedAt, updatedAt: startedAt }])}\n`,
      "utf8",
    );
    const reset = await fetch(`${web.base}/api/tasks/pool/reset`, { method: "POST" });
    assert.equal(reset.status, 200);
    assert.equal((await web.tasks.get("pool")).status, "offen");
  } finally {
    await web.cleanup();
  }
});

test("web chat uses the injected assistant and rejects an empty message", async () => {
  const web = await withWeb();
  try {
    const empty = await fetch(`${web.base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "  " }),
    });
    assert.equal(empty.status, 400);

    const response = await fetch(`${web.base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Whirlpool putzen" }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { reply: string };
    assert.equal(body.reply, "Echo: Whirlpool putzen");
    assert.deepEqual(web.seen, ["Whirlpool putzen"]);

    const missing = await fetch(`${web.base}/api/tasks/fehlt/complete`, { method: "POST" });
    assert.equal(missing.status, 404);
  } finally {
    await web.cleanup();
  }
});
