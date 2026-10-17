import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createAssistant } from "../src/assistant.ts";
import type { LlmClient, LlmResult } from "../src/bot/tools.ts";
import { createTaskService } from "../src/tasks/service.ts";
import { createTranscriptService } from "../src/transcripts/service.ts";

test("assistant reply runs tools and returns the model text", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-assistant-"));
  const transcriptsDir = await mkdtemp(path.join(tmpdir(), "jarvis-assistant-tr-"));
  try {
    const tasks = createTaskService({ dataDir });
    const transcripts = createTranscriptService({ transcriptsDir });
    let round = 0;
    const llm: LlmClient = {
      async complete(): Promise<LlmResult> {
        round += 1;
        if (round === 1) {
          return {
            content: null,
            tool_calls: [
              {
                id: "call_tim",
                name: "add_task",
                arguments: {
                  titel: "Tim antworten",
                  aufgabe: "Tim wegen Samstag antworten",
                  faelligAm: "2026-10-18T09:00:00+02:00",
                },
              },
            ],
          };
        }
        return { content: "Notiert: Tim morgen um 9." };
      },
    };

    const assistant = createAssistant({
      llm,
      systemPrompt: "Du bist Jarvis.",
      tasks,
      transcripts,
      timeZone: "Europe/Berlin",
      now: () => new Date("2026-10-17T15:00:00+02:00"),
    });

    const reply = await assistant.reply("Tim wegen Samstag antworten");
    assert.equal(reply, "Notiert: Tim morgen um 9.");
    const listed = await tasks.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.titel, "Tim antworten");
    assert.equal(listed[0]?.faelligAm, "2026-10-18T09:00:00+02:00");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(transcriptsDir, { recursive: true, force: true });
  }
});
