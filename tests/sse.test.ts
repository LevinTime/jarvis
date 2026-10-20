import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createEventBus } from "../src/events.ts";
import { createTaskService } from "../src/tasks/service.ts";
import { createWebApp, SSE_HEARTBEAT_MS, startWebServer, WEB_HOST } from "../src/web/server.ts";

async function readUntil(
  response: Response,
  includes: string,
  timeoutMs = 2000,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("kein stream");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      const next = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (!next || next.done) {
        break;
      }
      buffer += decoder.decode(next.value);
      if (buffer.includes(includes)) {
        return buffer;
      }
    }
    throw new Error(`SSE ohne ${includes}: ${buffer}`);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

test("sse replays after Last-Event-ID, sends resync when the buffer is too old, and cleans up", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-sse-"));
  const events = createEventBus({ capacity: 2 });
  const tasks = createTaskService({ dataDir });
  const app = createWebApp({
    tasks,
    events,
    reply: async () => "ok",
  });
  const started = await startWebServer(app, { port: 0 });
  const base = `http://${WEB_HOST}:${started.port}`;
  try {
    const first = events.emit({
      type: "status:changed",
      telegramConnected: false,
      llmConfigured: true,
    });
    const second = events.emit({
      type: "status:changed",
      telegramConnected: true,
      llmConfigured: true,
    });
    const replay = await fetch(`${base}/api/events`, {
      headers: { "last-event-id": String(first.id) },
    });
    assert.equal(replay.headers.get("content-type"), "text/event-stream");
    assert.equal(replay.headers.get("cache-control"), "no-cache");
    assert.equal(replay.headers.get("x-accel-buffering"), "no");
    assert.equal(SSE_HEARTBEAT_MS, 15_000);
    const replayBody = await readUntil(replay, `"id":${second.id}`);
    assert.match(replayBody, new RegExp(`id: ${second.id}`));
    assert.doesNotMatch(replayBody, new RegExp(`id: ${first.id}\\b`));

    events.emit({ type: "status:changed", telegramConnected: false, llmConfigured: false });
    events.emit({ type: "status:changed", telegramConnected: false, llmConfigured: false });
    const stale = await fetch(`${base}/api/events`, {
      headers: { "last-event-id": "1" },
    });
    const staleBody = await readUntil(stale, "event: resync");
    assert.match(staleBody, /event: resync/);

    const liveAbort = new AbortController();
    const live = await fetch(`${base}/api/events`, { signal: liveAbort.signal });
    liveAbort.abort();
    await live.body?.cancel().catch(() => undefined);
    const deadline = Date.now() + 1000;
    while (events.listenerCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(events.listenerCount(), 0);
  } finally {
    await started.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
