import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { createMessageHandler, systemPromptFor } from "../src/assistant.ts";
import type { LlmClient } from "../src/bot/tools.ts";
import { createEventBus } from "../src/events.ts";
import { createMessageStore } from "../src/messages/store.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createTaskService } from "../src/tasks/service.ts";
import { createTranscriptService } from "../src/transcripts/service.ts";

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await sourceFiles(full)));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

test("german and english dictionaries match and every call has a key", async () => {
  const de = JSON.parse(await readFile("web/src/i18n/de.json", "utf8")) as Record<string, string>;
  const en = JSON.parse(await readFile("web/src/i18n/en.json", "utf8")) as Record<string, string>;
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  for (const key of Object.keys(de)) {
    assert.equal(de[key]?.trim().length > 0, true, key);
    assert.equal(en[key]?.trim().length > 0, true, key);
  }

  const literal = /\b(?:t|tr)\(\s*["']([^"']+)["']/g;
  const dynamic = /\b(?:t|tr)\(\s*(?!["'])/g;
  const used = new Set<string>();
  for (const file of await sourceFiles(path.resolve("web/src"))) {
    if (file.endsWith(`${path.sep}i18n${path.sep}index.ts`)) {
      continue;
    }
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(literal)) {
      const key = match[1];
      if (key) {
        used.add(key);
      }
    }
    const leftovers = text.match(dynamic) ?? [];
    assert.deepEqual(leftovers, [], file);
  }
  for (const key of used) {
    assert.equal(key in de, true, key);
    assert.equal(key in en, true, key);
  }
  assert.equal(used.size > 20, true);
});

test("english replies add one sentence and german keeps the system prompt", async () => {
  const base = "Du bist Jarvis.\n";
  assert.equal(systemPromptFor(base, "de"), base);
  assert.equal(systemPromptFor(base, "en"), "Du bist Jarvis.\n\nReply in English.");

  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-lang-"));
  const transcriptsDir = await mkdtemp(path.join(tmpdir(), "jarvis-lang-tr-"));
  try {
    const seen: string[] = [];
    const llm: LlmClient = {
      async complete(input) {
        const first = input.messages[0];
        seen.push(first && "content" in first && typeof first.content === "string" ? first.content : "");
        return { content: "ok" };
      },
    };
    const shared = {
      llm,
      systemPrompt: base,
      tasks: createTaskService({ dataDir }),
      transcripts: createTranscriptService({ transcriptsDir }),
      messages: createMessageStore({ dataDir }),
      events: createEventBus(),
      timeZone: "Europe/Berlin",
      now: () => new Date("2026-10-19T09:30:00+02:00"),
    };
    const english = createMessageHandler({
      ...shared,
      replyLanguage: async (): Promise<"en"> => "en",
    });
    await (await english.handleUserMessage({ text: "Hi", source: "web" })).done;
    const broken = createMessageHandler({
      ...shared,
      replyLanguage: async () => {
        throw new Error("settings down");
      },
    });
    await (await broken.handleUserMessage({ text: "Noch mal", source: "web", clientId: "again" })).done;
    assert.equal(seen[0], "Du bist Jarvis.\n\nReply in English.");
    assert.equal(seen[1], "Du bist Jarvis.");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(transcriptsDir, { recursive: true, force: true });
  }
});
