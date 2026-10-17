import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createNoteService } from "../src/notes/service.ts";
import { createTaskService } from "../src/tasks/service.ts";
import { createTranscriptService } from "../src/transcripts/service.ts";
import {
  chatWithTools,
  createBotTools,
  type LlmClient,
  type LlmResult,
} from "../src/bot/tools.ts";

const SAMPLE_TRANSCRIPT = `# Gesprächsprotokoll Levin und Jarvis, Freitag, 16.10.2026

| Uhrzeit | Sprecher | Text |
|---|---|---|
| 14:45 | Jarvis | Prompt für den Telegram-Bot geschrieben. |
| 14:58 | Levin | Task-Modul gebaut. |
`;

async function withTools() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-bot-tasks-"));
  const transcriptsDir = await mkdtemp(path.join(tmpdir(), "jarvis-bot-tr-"));
  const tasks = createTaskService({ dataDir });
  const transcripts = createTranscriptService({ transcriptsDir });
  const tools = createBotTools(tasks, transcripts);
  return {
    tasks,
    transcripts,
    tools,
    transcriptsDir,
    async cleanup() {
      await rm(dataDir, { recursive: true, force: true });
      await rm(transcriptsDir, { recursive: true, force: true });
    },
  };
}

test("add_task stores titel, aufgabe and faelligAm via the task service", async () => {
  const { tasks, tools, cleanup } = await withTools();
  try {
    const raw = await tools.execute("add_task", {
      titel: "Whirlpool",
      aufgabe: "heute noch Whirlpool sauber machen",
      faelligAm: "2026-10-17T20:00:00+02:00",
    });
    const parsed = JSON.parse(raw) as { ok: boolean; task: { id: string } };
    assert.equal(parsed.ok, true);
    const loaded = await tasks.get(parsed.task.id);
    assert.equal(loaded.titel, "Whirlpool");
    assert.equal(loaded.aufgabe, "heute noch Whirlpool sauber machen");
    assert.equal(loaded.faelligAm, "2026-10-17T20:00:00+02:00");
    assert.equal(loaded.status, "offen");
  } finally {
    await cleanup();
  }
});

test("complete_task marks an open task as erledigt", async () => {
  const { tasks, tools, cleanup } = await withTools();
  try {
    const created = await tasks.create({
      id: "huehner",
      titel: "Hühner füttern",
      aufgabe: "abends Hühner füttern",
    });
    const raw = await tools.execute("complete_task", { id: created.id });
    const parsed = JSON.parse(raw) as { ok: boolean; task: { status: string } };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.task.status, "erledigt");
    assert.equal((await tasks.get("huehner")).status, "erledigt");
  } finally {
    await cleanup();
  }
});

test("list_transcripts and get_transcript read the transcript service", async () => {
  const { tools, transcriptsDir, cleanup } = await withTools();
  try {
    await writeFile(
      path.join(transcriptsDir, "2026-10-16.md"),
      SAMPLE_TRANSCRIPT,
      "utf8",
    );

    const listedRaw = await tools.execute("list_transcripts", {});
    const listed = JSON.parse(listedRaw) as {
      transcripts: Array<{ id: string; title: string; entries: number }>;
    };
    assert.equal(listed.transcripts.length, 1);
    assert.equal(listed.transcripts[0]?.id, "2026-10-16");
    assert.equal(listed.transcripts[0]?.entries, 2);

    const gotRaw = await tools.execute("get_transcript", { id: "2026-10-16" });
    const got = JSON.parse(gotRaw) as {
      transcript: { entries: Array<{ text: string }> };
    };
    assert.match(
      got.transcript.entries[0]?.text ?? "",
      /Prompt für den Telegram-Bot/,
    );
  } finally {
    await cleanup();
  }
});

test("mocked Grok splits a message into two tasks with due times", async () => {
  const { tasks, tools, cleanup } = await withTools();
  try {
    let round = 0;
    const llm: LlmClient = {
      async complete(): Promise<LlmResult> {
        round += 1;
        if (round === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "call_pool",
                name: "add_task",
                arguments: {
                  titel: "Whirlpool",
                  aufgabe: "heute noch Whirlpool sauber machen",
                  faelligAm: "2026-10-17T20:00:00+02:00",
                },
              },
              {
                id: "call_huehner",
                name: "add_task",
                arguments: {
                  titel: "Hühner füttern",
                  aufgabe: "abends Hühner füttern",
                  faelligAm: "2026-10-17T18:00:00+02:00",
                },
              },
            ],
          };
        }
        return {
          content:
            "Alles klar: Whirlpool bis 20:00 und Hühner füttern um 18:00.",
        };
      },
    };

    const reply = await chatWithTools({
      llm,
      systemPrompt: "Du bist Jarvis.",
      userText: "heute noch Whirlpool sauber machen, abends Hühner füttern",
      tools: tools.definitions,
      execute: tools.execute,
      now: new Date("2026-10-17T15:00:00+02:00"),
      timeZone: "Europe/Berlin",
    });

    assert.equal(
      reply,
      "Alles klar: Whirlpool bis 20:00 und Hühner füttern um 18:00.",
    );
    const listed = await tasks.list();
    assert.equal(listed.length, 2);
    const pool = listed.find((task) => task.titel === "Whirlpool");
    const huehner = listed.find((task) => task.titel === "Hühner füttern");
    assert.equal(pool?.faelligAm, "2026-10-17T20:00:00+02:00");
    assert.equal(huehner?.faelligAm, "2026-10-17T18:00:00+02:00");
    assert.equal(pool?.status, "offen");
    assert.equal(huehner?.status, "offen");
  } finally {
    await cleanup();
  }
});

test("add_note list_open_notes and close_note keep a person note", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-bot-notes-"));
  const transcriptsDir = await mkdtemp(path.join(tmpdir(), "jarvis-bot-notes-tr-"));
  try {
    const tasks = createTaskService({ dataDir });
    const transcripts = createTranscriptService({ transcriptsDir });
    const notes = createNoteService({ dataDir });
    const tools = createBotTools(tasks, transcripts, notes);

    const raw = await tools.execute("add_note", {
      person: "Tim",
      text: "wollte ihm wegen Samstag noch antworten",
      erinnernAm: "2026-10-18T09:00:00+02:00",
    });
    const created = JSON.parse(raw) as {
      ok: boolean;
      note: { id: string; offen: boolean; person: string };
    };
    assert.equal(created.ok, true);
    assert.equal(created.note.person, "Tim");
    assert.equal(created.note.offen, true);

    const open = JSON.parse(await tools.execute("list_open_notes", {})) as {
      notes: Array<{ id: string }>;
    };
    assert.equal(open.notes.length, 1);

    const closed = JSON.parse(
      await tools.execute("close_note", { id: created.note.id }),
    ) as { note: { offen: boolean } };
    assert.equal(closed.note.offen, false);
    const after = JSON.parse(await tools.execute("list_open_notes", {})) as {
      notes: unknown[];
    };
    assert.equal(after.notes.length, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(transcriptsDir, { recursive: true, force: true });
  }
});

test("list_tasks after complete_task returns the erledigt status", async () => {
  const { tools, cleanup } = await withTools();
  try {
    await tools.execute("add_task", {
      titel: "Whirlpool",
      aufgabe: "putzen",
    });
    const listedOpen = JSON.parse(await tools.execute("list_tasks", {})) as {
      tasks: Array<{ id: string; status: string }>;
    };
    assert.equal(listedOpen.tasks[0]?.status, "offen");
    await tools.execute("complete_task", { id: listedOpen.tasks[0]?.id });
    const listedDone = JSON.parse(await tools.execute("list_tasks", {})) as {
      tasks: Array<{ status: string }>;
    };
    assert.equal(listedDone.tasks[0]?.status, "erledigt");
  } finally {
    await cleanup();
  }
});
