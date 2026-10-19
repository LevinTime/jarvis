import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createMessageHandler } from "../src/assistant.ts";
import type { LlmClient, LlmResult } from "../src/bot/tools.ts";
import { createEventBus } from "../src/events.ts";
import { createMessageStore } from "../src/messages/store.ts";
import { createTaskService } from "../src/tasks/service.ts";
import { createTranscriptService } from "../src/transcripts/service.ts";

async function withHandler(llm: LlmClient, timeoutMs = 60_000) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-queue-"));
  const transcriptsDir = await mkdtemp(path.join(tmpdir(), "jarvis-queue-tr-"));
  const handler = createMessageHandler({
    llm,
    systemPrompt: "Du bist Jarvis.",
    tasks: createTaskService({ dataDir }),
    transcripts: createTranscriptService({ transcriptsDir }),
    messages: createMessageStore({ dataDir }),
    events: createEventBus(),
    timeoutMs,
  });
  return {
    handler,
    async cleanup() {
      await rm(dataDir, { recursive: true, force: true });
      await rm(transcriptsDir, { recursive: true, force: true });
    },
  };
}

test("two messages are answered one after another", async () => {
  let started = 0;
  let releaseFirst: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const llm: LlmClient = {
    async complete(): Promise<LlmResult> {
      started += 1;
      const turn = started;
      if (turn === 1) {
        await gate;
      }
      return { content: `antwort-${turn}` };
    },
  };
  const ctx = await withHandler(llm);
  try {
    const first = await ctx.handler.handleUserMessage({ text: "eins", source: "web" });
    const second = await ctx.handler.handleUserMessage({ text: "zwei", source: "web" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(started, 1);
    releaseFirst();
    const doneFirst = await first.done;
    const doneSecond = await second.done;
    assert.equal(doneFirst.assistant?.text, "antwort-1");
    assert.equal(doneSecond.assistant?.text, "antwort-2");
    assert.equal(doneFirst.user.status, "done");
    assert.equal(started, 2);
  } finally {
    await ctx.cleanup();
  }
});

test("403, 429 and timeout become a German error status", async () => {
  const cases: Array<{ error: unknown; snippet: string }> = [
    { error: Object.assign(new Error("no credits"), { status: 403 }), snippet: "403" },
    { error: Object.assign(new Error("slow down"), { status: 429 }), snippet: "429" },
    { error: Object.assign(new Error("timed out"), { name: "TimeoutError" }), snippet: "lange gedauert" },
  ];
  for (const item of cases) {
    const llm: LlmClient = {
      async complete(): Promise<LlmResult> {
        throw item.error;
      },
    };
    const ctx = await withHandler(llm, 50);
    try {
      const turn = await ctx.handler.handleUserMessage({ text: "hallo", source: "telegram" });
      const finished = await turn.done;
      assert.equal(finished.user.status, "error");
      assert.match(finished.user.error ?? "", new RegExp(item.snippet));
      assert.equal(finished.assistant, null);
    } finally {
      await ctx.cleanup();
    }
  }
});

test("a hanging model call times out with a German message", async () => {
  const llm: LlmClient = {
    complete(): Promise<LlmResult> {
      return new Promise(() => undefined);
    },
  };
  const ctx = await withHandler(llm, 40);
  try {
    const turn = await ctx.handler.handleUserMessage({ text: "hallo", source: "web" });
    const finished = await turn.done;
    assert.equal(finished.user.status, "error");
    assert.match(finished.user.error ?? "", /lange gedauert/);
  } finally {
    await ctx.cleanup();
  }
});

test("the same clientId is not processed twice", async () => {
  let calls = 0;
  const llm: LlmClient = {
    async complete(): Promise<LlmResult> {
      calls += 1;
      return { content: "einmal" };
    },
  };
  const ctx = await withHandler(llm);
  try {
    const first = await ctx.handler.handleUserMessage({
      text: "hallo",
      source: "web",
      clientId: "same",
    });
    await first.done;
    const second = await ctx.handler.handleUserMessage({
      text: "hallo nochmal",
      source: "web",
      clientId: "same",
    });
    assert.equal(second.duplicate, true);
    assert.equal(second.message.id, first.message.id);
    assert.equal(calls, 1);
  } finally {
    await ctx.cleanup();
  }
});
