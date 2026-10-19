import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createMessageHandler } from "../src/assistant.ts";
import { createTelegramBot } from "../src/bot/telegram.ts";
import { chatWithTools, createBotTools, type LlmClient, type LlmMessage } from "../src/bot/tools.ts";
import { createEventBus } from "../src/events.ts";
import { createCorrectionStore } from "../src/memory/corrections.ts";
import {
  applySelfCheck,
  estimateTokens,
  memoryLine,
  MemoryValidationError,
  needsSelfCheck,
  parseFalschReply,
  renderMemoryContext,
  selectMemory,
  type MemoryFact,
} from "../src/memory/model.ts";
import { BUDGET_FACT, createMemoryStore } from "../src/memory/store.ts";
import { createMessageStore } from "../src/messages/store.ts";
import { createTaskService } from "../src/tasks/service.ts";
import { createTranscriptService } from "../src/transcripts/service.ts";
import { createWebApp, startWebServer, WEB_HOST } from "../src/web/server.ts";

const NOW = new Date("2026-10-19T10:00:00.000Z");

function contentOf(message: LlmMessage | undefined): string {
  if (!message || message.role === "tool") {
    return "";
  }
  return message.content ?? "";
}

function fact(partial: Partial<MemoryFact> & Pick<MemoryFact, "text" | "wichtigkeit">): MemoryFact {
  return {
    id: partial.id ?? partial.text,
    text: partial.text,
    kategorie: partial.kategorie ?? "regel",
    quelle: partial.quelle ?? "manuell",
    erstelltAm: partial.erstelltAm ?? "2026-10-19T08:00:00.000Z",
    zuletztBestätigt: partial.zuletztBestätigt ?? "2026-10-19T08:00:00.000Z",
    wichtigkeit: partial.wichtigkeit,
    aktiv: partial.aktiv ?? true,
    ...(partial.verlauf ? { verlauf: partial.verlauf } : {}),
  };
}

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

test("memory saves, dedupes, replaces contradictions and skips secrets", async () => {
  const dataDir = await tempDir("jarvis-memory-");
  const stamps = [
    "2026-10-19T10:00:00.000Z",
    "2026-10-19T11:00:00.000Z",
    "2026-10-19T12:00:00.000Z",
    "2026-10-19T13:00:00.000Z",
  ];
  let tick = 0;
  const memory = createMemoryStore({
    dataDir,
    now: () => new Date(stamps[Math.min(tick++, stamps.length - 1)] ?? stamps[0]!),
  });
  try {
    const first = await memory.remember({
      text: "Levin trinkt Kaffee schwarz.",
      kategorie: "vorliebe",
      quelle: "web",
      wichtigkeit: 1,
    });
    const same = await memory.remember({
      text: "levin trinkt kaffee schwarz",
      quelle: "telegram",
      wichtigkeit: 3,
    });
    assert.equal(same.id, first.id);
    assert.equal(same.wichtigkeit, 3);
    assert.equal(same.zuletztBestätigt, stamps[1]);
    assert.equal((await memory.list()).length, 1);

    const lower = await memory.remember({
      text: "Levin trinkt Kaffee schwarz",
      quelle: "manuell",
      wichtigkeit: 1,
    });
    assert.equal(lower.wichtigkeit, 3);

    const replaced = await memory.remember({
      text: "Levin trinkt Tee",
      kategorie: "vorliebe",
      quelle: "telegram",
      wichtigkeit: 2,
    });
    assert.equal(replaced.id, first.id);
    assert.equal(replaced.erstelltAm, first.erstelltAm);
    assert.equal(replaced.text, "Levin trinkt Tee");
    assert.equal(replaced.verlauf?.[0]?.text, "Levin trinkt Kaffee schwarz.");
    assert.equal((await memory.list()).filter((item) => item.aktiv).length, 1);

    const pizza = await memory.remember({ text: "Levin mag Pizza", quelle: "manuell" });
    const nadja = await memory.remember({ text: "Nadja mag Pizza", kategorie: "person", quelle: "manuell" });
    assert.notEqual(pizza.id, nadja.id);

    const secrets = [
      "Der Key ist xai-abcdefghijklmnopqrstuvwxyz",
      "sk-abcdefghijklmnopqrstuvwxyz",
      "123456789:AAHsecretsecretsecretsecret",
      "IBAN DE89370400440532013000",
      "passwort: geheim123",
      "Das Passwort ist geheim12",
    ];
    for (const text of secrets) {
      await assert.rejects(() => memory.remember({ text, quelle: "manuell" }), MemoryValidationError);
    }
    await memory.remember({ text: "Ich habe das Passwort vergessen", quelle: "manuell" });
    const raw = await readFile(path.join(dataDir, "memory.json"), "utf8");
    assert.equal(raw.includes("xai-"), false);
    assert.equal(raw.includes("geheim123"), false);
    assert.equal(raw.includes("DE89370400440532013000"), false);
    const markdown = await readFile(path.join(dataDir, "memory.md"), "utf8");
    assert.match(markdown, /Levin trinkt Tee/);
    assert.equal(markdown.includes("geheim"), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("budget fact is seeded only when memory.json is missing", async () => {
  const dataDir = await tempDir("jarvis-seed-");
  try {
    await writeFile(path.join(dataDir, "memory.json"), "[]\n", "utf8");
    const existing = createMemoryStore({ dataDir, now: () => NOW });
    await existing.seedBudgetFact();
    assert.equal((await existing.list()).length, 0);

    await rm(path.join(dataDir, "memory.json"));
    const fresh = createMemoryStore({ dataDir, now: () => NOW });
    await fresh.seedBudgetFact();
    await fresh.seedBudgetFact();
    const rows = await fresh.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.text, BUDGET_FACT);
    assert.equal(rows[0]?.wichtigkeit, 3);
    assert.equal(rows[0]?.kategorie, "regel");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("retrieval keeps importance 3 and stays inside the token cap", () => {
  const huge = "A".repeat(500);
  const rows = [
    fact({ id: "huge", text: huge, wichtigkeit: 3, zuletztBestätigt: "2026-10-19T12:00:00.000Z" }),
    fact({ id: "short", text: "Kurz und wichtig.", wichtigkeit: 3, zuletztBestätigt: "2026-10-19T11:00:00.000Z" }),
    fact({ id: "pizza", text: "Pizza bleibt der Favorit.", wichtigkeit: 1, zuletztBestätigt: "2026-10-19T10:00:00.000Z" }),
    fact({ id: "off", text: "Pizza ist vergessen.", wichtigkeit: 3, aktiv: false }),
  ];
  const picked = selectMemory(rows, "nichts davon", 40);
  assert.deepEqual(picked.map((item) => item.id), ["short"]);
  const withKeyword = selectMemory(rows, "Wie steht es um Pizza?", 800);
  assert.equal(withKeyword.some((item) => item.id === "pizza"), true);
  assert.equal(withKeyword.some((item) => item.id === "short"), true);
  assert.equal(withKeyword.some((item) => item.id === "off"), false);
  const packed = withKeyword.reduce((sum, item) => sum + estimateTokens(memoryLine(item)), 0);
  assert.equal(packed <= 800, true);
  assert.equal(estimateTokens(memoryLine(rows[0]!)) > 40, true);
});

test("cost check mode stays out of the cached system prompt", async () => {
  assert.equal(renderMemoryContext([], "an"), "");
  assert.match(renderMemoryContext([], "aus"), /Kosten-Check: aus/);
  assert.match(renderMemoryContext([], "kaeufe"), /nur bei Käufen/);

  const dataDir = await tempDir("jarvis-cost-");
  const transcriptsDir = await tempDir("jarvis-cost-tr-");
  try {
    const memory = createMemoryStore({ dataDir, now: () => NOW });
    await memory.remember({ text: "Levin mag Pizza", quelle: "manuell", wichtigkeit: 2 });
    const seen: LlmMessage[][] = [];
    const llm: LlmClient = {
      async complete(input) {
        seen.push(input.messages.map((message) => ({ ...message })));
        return { content: "alles klar" };
      },
    };
    const handler = createMessageHandler({
      llm,
      systemPrompt: "Du bist Jarvis.\n",
      tasks: createTaskService({ dataDir }),
      transcripts: createTranscriptService({ transcriptsDir }),
      messages: createMessageStore({ dataDir }),
      events: createEventBus(),
      memory,
      now: () => NOW,
      readTurnSettings: async () => ({ costCheck: "aus", selfCheck: false }),
    });
    await (await handler.handleUserMessage({ text: "Pizza heute?", source: "web" })).done;
    const messages = seen[0] ?? [];
    assert.equal(contentOf(messages[0]), "Du bist Jarvis.");
    assert.match(contentOf(messages[1]), /Levin mag Pizza/);
    assert.match(contentOf(messages[1]), /Kosten-Check: aus/);
    assert.match(contentOf(messages.at(-1)), /^Aktuelle Zeit:/);
    assert.equal(seen.length, 1);

    const quiet: LlmMessage[][] = [];
    const quietLlm: LlmClient = {
      async complete(input) {
        quiet.push(input.messages);
        return { content: "alles klar" };
      },
    };
    await chatWithTools({
      llm: quietLlm,
      systemPrompt: "Du bist Jarvis.\n",
      userText: "Hallo",
      tools: [],
      execute: async () => "{}",
      now: NOW,
      context: "   ",
    });
    assert.equal(quiet[0]?.length, 3);
    assert.equal(quiet[0]?.some((message) => contentOf(message).includes("Kosten-Check")), false);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(transcriptsDir, { recursive: true, force: true });
  }
});

test("self-check runs once and only for triggered answers", async () => {
  assert.equal(needsSelfCheck("alles klar danke"), false);
  assert.equal(needsSelfCheck("Treffen am Montag"), true);
  assert.equal(needsSelfCheck("Das kostet 12"), true);
  assert.equal(needsSelfCheck("Der Preis bleibt offen"), true);
  assert.equal(needsSelfCheck("Hallo Levin"), true);
  assert.equal(needsSelfCheck("Berlin ist ruhig"), false);
  assert.equal(applySelfCheck("alt", "ok, passt"), "alt");
  assert.equal(applySelfCheck("alt", "Am 21. ist es Dienstag."), "Am 21. ist es Dienstag.");
  assert.equal(parseFalschReply("  Falsch: Dienstag "), "Dienstag");
  assert.equal(parseFalschReply("falsch:"), "als falsch markiert");
  assert.equal(parseFalschReply("nein"), null);

  const dataDir = await tempDir("jarvis-check-");
  const transcriptsDir = await tempDir("jarvis-check-tr-");
  try {
    async function run(options: {
      answer: string;
      verdict?: string;
      selfCheck: boolean;
      fail?: boolean;
      text: string;
    }) {
      const calls: Array<{ purpose?: string; maxTokens?: number; effort?: string }> = [];
      const llm: LlmClient = {
        async complete(input) {
          calls.push({
            purpose: input.purpose,
            maxTokens: input.maxTokens,
            effort: input.reasoningEffort,
          });
          if (input.purpose === "selfcheck") {
            if (options.fail) {
              throw new Error("check down");
            }
            return { content: options.verdict ?? "ok" };
          }
          return { content: options.answer };
        },
      };
      const messages = createMessageStore({ dataDir });
      const handler = createMessageHandler({
        llm,
        systemPrompt: "Du bist Jarvis.",
        tasks: createTaskService({ dataDir }),
        transcripts: createTranscriptService({ transcriptsDir }),
        messages,
        events: createEventBus(),
        now: () => NOW,
        readTurnSettings: async () => ({ costCheck: "an", selfCheck: options.selfCheck }),
      });
      const finished = await (await handler.handleUserMessage({
        text: options.text,
        source: "web",
        clientId: `${options.text}-${options.answer}-${String(options.selfCheck)}-${String(options.fail)}`,
      })).done;
      return { calls, text: finished.assistant?.text ?? "" };
    }

    const corrected = await run({
      answer: "Treffen am Montag mit Nadja.",
      verdict: "Am 21. ist es Dienstag.",
      selfCheck: true,
      text: "Wann ist das Coaching?",
    });
    assert.equal(corrected.calls.length, 2);
    assert.equal(corrected.calls[0]?.purpose, "chat");
    assert.equal(corrected.calls[1]?.purpose, "selfcheck");
    assert.equal(corrected.calls[1]?.maxTokens, 150);
    assert.equal(corrected.calls[1]?.effort, "none");
    assert.equal(corrected.text, "Am 21. ist es Dienstag.");

    const plain = await run({
      answer: "alles klar danke",
      selfCheck: true,
      text: "Danke",
    });
    assert.equal(plain.calls.length, 1);

    const off = await run({
      answer: "Treffen am Montag",
      selfCheck: false,
      text: "Nochmal der Termin",
    });
    assert.equal(off.calls.length, 1);
    assert.equal(off.text, "Treffen am Montag");

    const kept = await run({
      answer: "Der Preis ist 12 Euro",
      verdict: "ok",
      selfCheck: true,
      text: "Was kostet das?",
    });
    assert.equal(kept.calls.length, 2);
    assert.equal(kept.text, "Der Preis ist 12 Euro");

    const failed = await run({
      answer: "Nadja kommt um 16 Uhr",
      selfCheck: true,
      fail: true,
      text: "Wann kommt Nadja?",
    });
    assert.equal(failed.calls.length, 2);
    assert.equal(failed.text, "Nadja kommt um 16 Uhr");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(transcriptsDir, { recursive: true, force: true });
  }
});

test("tools reject secrets and report a missing memory store", async () => {
  const dataDir = await tempDir("jarvis-tools-mem-");
  const transcriptsDir = await tempDir("jarvis-tools-mem-tr-");
  try {
    const tasks = createTaskService({ dataDir });
    const transcripts = createTranscriptService({ transcriptsDir });
    const memory = createMemoryStore({ dataDir, now: () => NOW });
    const tools = createBotTools(tasks, transcripts, undefined, memory);
    const rejected = JSON.parse(await tools.execute("remember_fact", { text: "token: abcdefghijk" })) as {
      error?: string;
    };
    assert.equal(typeof rejected.error, "string");
    assert.equal((await memory.list()).length, 0);
    const saved = JSON.parse(await tools.execute("remember_fact", {
      text: "Levin wohnt in Issum",
      kategorie: "ort",
    })) as { ok?: boolean; fact?: { id: string } };
    assert.equal(saved.ok, true);
    const bare = createBotTools(tasks, transcripts);
    const missing = JSON.parse(await bare.execute("forget_fact", { stichwort: "Issum" })) as { error?: string };
    assert.match(missing.error ?? "", /nicht verfügbar/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(transcriptsDir, { recursive: true, force: true });
  }
});

test("app and telegram corrections land in memory context", async () => {
  const dataDir = await tempDir("jarvis-corr-");
  const transcriptsDir = await tempDir("jarvis-corr-tr-");
  try {
    const memory = createMemoryStore({ dataDir, now: () => NOW });
    const corrections = createCorrectionStore({ dataDir, memory, now: () => NOW });
    const messages = createMessageStore({ dataDir });
    const tasks = createTaskService({ dataDir });
    const events = createEventBus();
    const user = await messages.append({
      source: "web",
      role: "user",
      text: "Wann ist das Coaching?",
      status: "done",
    });
    const answer = await messages.append({
      source: "web",
      role: "assistant",
      text: "Am Montag um 8.",
      status: "done",
    });
    const app = createWebApp({
      tasks,
      messages,
      events,
      memory,
      corrections,
      now: () => NOW,
      reply: async () => "",
    });
    const started = await startWebServer(app, { port: 0 });
    const base = `http://${WEB_HOST}:${started.port}`;
    try {
      const created = await fetch(`${base}/api/corrections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: answer.message.id, korrektur: "Dienstag" }),
      });
      assert.equal(created.status, 201);
      const createdBody = (await created.json()) as { correction: { id: string; frage: string } };
      assert.equal(createdBody.correction.frage, user.message.text);
      const again = await fetch(`${base}/api/corrections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: answer.message.id, korrektur: "Dienstag" }),
      });
      const againBody = (await again.json()) as { correction: { id: string } };
      assert.equal(againBody.correction.id, createdBody.correction.id);

      const listed = await fetch(`${base}/api/memory?kategorie=korrektur`);
      assert.equal(listed.status, 200);
      const body = (await listed.json()) as {
        facts: Array<{ text: string; wichtigkeit: number }>;
        correctionsThisMonth: number;
      };
      assert.equal(body.facts.length, 1);
      assert.equal(body.facts[0]?.wichtigkeit, 3);
      assert.match(body.facts[0]?.text ?? "", /Dienstag/);
      assert.equal(body.correctionsThisMonth, 1);
      const relevant = await memory.relevant("hallo");
      assert.equal(relevant.some((item) => item.kategorie === "korrektur"), true);

      const secret = await fetch(`${base}/api/memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "api key: abcdefghijklmnop" }),
      });
      assert.equal(secret.status, 400);

      const manual = await fetch(`${base}/api/memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Marco kommt am Wochenende", kategorie: "person", wichtigkeit: 2 }),
      });
      assert.equal(manual.status, 201);
      const manualBody = (await manual.json()) as { fact: { id: string } };
      const patched = await fetch(`${base}/api/memory/${manualBody.fact.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Marco kommt am Freitag" }),
      });
      assert.equal(patched.status, 200);
      const removed = await fetch(`${base}/api/memory/${manualBody.fact.id}`, { method: "DELETE" });
      assert.equal(removed.status, 200);
      const after = (await (await fetch(`${base}/api/memory?q=Marco`)).json()) as { facts: unknown[] };
      assert.equal(after.facts.length, 0);
      const missing = await fetch(`${base}/api/memory/missing-id`, { method: "DELETE" });
      assert.equal(missing.status, 404);
    } finally {
      await started.close();
    }

    const calls: string[] = [];
    const bot = createTelegramBot({
      token: "1:test",
      allowedChatId: "42",
      handleText: async () => "Antwort",
      listAufgaben: async () => "",
      erledigt: async () => "",
      merken: async (text) => {
        const row = await memory.remember({ text, quelle: "telegram" });
        return `Gemerkt: ${row.text}`;
      },
      listMemory: async () => "liste",
      findMemory: async (query) => (await memory.search(query)).map((item) => ({ id: item.id, text: item.text })),
      forgetMemory: async (id) => (await memory.forget(id)).text,
      correct: async (input) => {
        await corrections.add({ ...input, quelle: "telegram" });
      },
    });
    bot.botInfo = {
      id: 1,
      is_bot: true,
      first_name: "Jarvis",
      username: "jarvis",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
    } as NonNullable<typeof bot.botInfo>;
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push(`${method} ${JSON.stringify(payload)}`);
      if (method === "answerCallbackQuery") {
        return { ok: true, result: true } as never;
      }
      return {
        ok: true,
        result: {
          message_id: 70,
          date: 1_700_000_000,
          chat: { id: 42, type: "private" },
          text: "ok",
        },
      } as never;
    });
    const update = (value: unknown) => bot.handleUpdate(value as Parameters<typeof bot.handleUpdate>[0]);
    await update({
      update_id: 1,
      message: {
        message_id: 1,
        date: 1_700_000_000,
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false, first_name: "Levin" },
        text: "/merken Levin hoert Podcasts",
        entities: [{ type: "bot_command", offset: 0, length: 7 }],
      },
    });
    const remembered = await memory.search("Podcasts");
    assert.equal(remembered.length, 1);
    await update({
      update_id: 2,
      message: {
        message_id: 2,
        date: 1_700_000_000,
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false, first_name: "Levin" },
        text: "/vergiss Podcasts",
        entities: [{ type: "bot_command", offset: 0, length: 8 }],
      },
    });
    assert.equal((await memory.search("Podcasts")).length, 1);
    assert.equal(calls.some((line) => line.includes(`forget:${remembered[0]?.id}`)), true);
    await update({
      update_id: 3,
      callback_query: {
        id: "cb-forget",
        from: { id: 42, is_bot: false, first_name: "Levin" },
        chat_instance: "x",
        data: `forget:${remembered[0]?.id}`,
        message: {
          message_id: 8,
          date: 1_700_000_000,
          chat: { id: 42, type: "private" },
          text: "Welchen Eintrag vergessen?",
        },
      },
    });
    assert.equal((await memory.search("Podcasts")).length, 0);

    await update({
      update_id: 4,
      message: {
        message_id: 9,
        date: 1_700_000_000,
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false, first_name: "Levin" },
        text: "falsch: Es ist Freitag",
        reply_to_message: {
          message_id: 8,
          date: 1_700_000_000,
          chat: { id: 42, type: "private" },
          text: "Der Termin ist Donnerstag",
          reply_to_message: {
            message_id: 7,
            date: 1_700_000_000,
            chat: { id: 42, type: "private" },
            text: "Welcher Tag?",
          },
        },
      },
    });
    const rows = await corrections.list();
    const telegramRow = rows.find((row) => row.quelle === "telegram" && row.korrektur === "Es ist Freitag");
    assert.equal(telegramRow?.falscheAntwort, "Der Termin ist Donnerstag");
    assert.equal(telegramRow?.frage, "Welcher Tag?");
    const inContext = await memory.relevant("ohne stichwort");
    assert.equal(inContext.some((item) => item.text.includes("Freitag")), true);

    await update({
      update_id: 5,
      callback_query: {
        id: "cb-wrong",
        from: { id: 42, is_bot: false, first_name: "Levin" },
        chat_instance: "x",
        data: "wrong",
        message: {
          message_id: 11,
          date: 1_700_000_000,
          chat: { id: 42, type: "private" },
          text: "Der Preis ist 12",
        },
      },
    });
    const thumb = (await corrections.list()).find((row) => row.falscheAntwort === "Der Preis ist 12");
    assert.equal(thumb?.korrektur, "als falsch markiert");
    assert.equal(thumb?.quelle, "telegram");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(transcriptsDir, { recursive: true, force: true });
  }
});

test("memory routes without a store stay compatible", async () => {
  const dataDir = await tempDir("jarvis-mem-empty-");
  try {
    const app = createWebApp({
      tasks: createTaskService({ dataDir }),
      now: () => NOW,
      reply: async () => "",
    });
    const started = await startWebServer(app, { port: 0 });
    try {
      const listed = await fetch(`http://${WEB_HOST}:${started.port}/api/memory`);
      assert.equal(listed.status, 200);
      const body = (await listed.json()) as { facts: unknown[]; correctionsThisMonth: number };
      assert.deepEqual(body.facts, []);
      assert.equal(body.correctionsThisMonth, 0);
      const created = await fetch(`http://${WEB_HOST}:${started.port}/api/memory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "Levin mag Tee" }),
      });
      assert.equal(created.status, 501);
    } finally {
      await started.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("the system prompt keeps its opening and does not hardcode the budget fact", async () => {
  const prompt = await readFile("prompts/system.md", "utf8");
  assert.match(prompt, /^Du bist Jarvis/);
  assert.match(prompt, /💸 Kosten-Check/);
  assert.equal(prompt.includes("ALG I"), false);
  assert.match(prompt, /remember_fact/);
});
