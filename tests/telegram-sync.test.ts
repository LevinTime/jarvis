import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deliverTelegramText,
  escapeMarkdownV2,
  formatWebMirror,
  isMirroredWebMessage,
  mirrorWebTurn,
  splitTelegramText,
} from "../src/bot/telegram.ts";

test("long telegram texts split under 4096 characters", () => {
  const text = `${"a".repeat(3000)}\n${"b".repeat(3000)}`;
  const parts = splitTelegramText(text);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((part) => part.length <= 4096));
  assert.equal(parts.join("\n"), text);
});

test("markdown v2 escapes special characters", () => {
  assert.equal(escapeMarkdownV2("Hallo. (Jarvis)"), "Hallo\\. \\(Jarvis\\)");
});

test("mirrored web lines are not treated as a new user message", () => {
  assert.equal(isMirroredWebMessage(formatWebMirror("Hühner füttern")), true);
  assert.equal(isMirroredWebMessage("Hühner füttern"), false);
});

test("a 429 waits for retry_after and a mirror failure does not throw", async () => {
  const waits: number[] = [];
  let calls = 0;
  await deliverTelegramText({
    text: "Hallo",
    sleep: async (ms) => {
      waits.push(ms);
    },
    send: async () => {
      calls += 1;
      if (calls === 1) {
        throw { error_code: 429, parameters: { retry_after: 2 }, message: "retry after 2" };
      }
    },
  });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);

  const result = await mirrorWebTurn({
    userText: "von der App",
    assistantText: "Antwort",
    send: async () => {
      throw new Error("netzwerk weg");
    },
  });
  assert.equal(result.ok, false);
});

test("a markdown parse error falls back to plain text", async () => {
  const modes: Array<"MarkdownV2" | "plain"> = [];
  await deliverTelegramText({
    text: "Hallo",
    send: async (_text, options) => {
      modes.push(options?.parseMode ?? "plain");
      if (options?.parseMode === "MarkdownV2") {
        throw new Error("can't parse entities");
      }
    },
  });
  assert.deepEqual(modes, ["MarkdownV2", "plain"]);
});
