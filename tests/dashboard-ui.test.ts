import assert from "node:assert/strict";
import { test } from "node:test";
import { orbMoves, resolveOrbState, SPEAK_FOR_MS, type OrbMessage } from "../src/web-logic/orb-state.ts";

const at = Date.parse("2026-10-20T11:00:00.000Z");

function message(partial: Partial<OrbMessage> & Pick<OrbMessage, "role" | "status">): OrbMessage {
  return {
    id: partial.id ?? partial.role,
    role: partial.role,
    status: partial.status,
    ts: partial.ts ?? "2026-10-20T11:00:00.000Z",
  };
}

test("orb follows chat: thinking, then speaking, then idle", () => {
  assert.equal(resolveOrbState({ messages: [], now: at }), "idle");
  assert.equal(
    resolveOrbState({
      messages: [message({ role: "user", status: "pending" })],
      now: at,
    }),
    "thinking",
  );
  assert.equal(
    resolveOrbState({
      messages: [
        message({ id: "u", role: "user", status: "done", ts: "2026-10-20T11:00:00.000Z" }),
        message({ id: "a", role: "assistant", status: "done", ts: "2026-10-20T11:00:02.000Z" }),
      ],
      now: at + 2500,
    }),
    "speaking",
  );
  const repliedAt = Date.parse("2026-10-20T11:00:02.000Z");
  assert.equal(
    resolveOrbState({
      messages: [message({ role: "assistant", status: "done", ts: "2026-10-20T11:00:02.000Z" })],
      now: repliedAt + SPEAK_FOR_MS + 50,
    }),
    "idle",
  );
});

test("listening stays off unless speech input already exists", () => {
  assert.equal(resolveOrbState({ messages: [], now: at, listening: false }), "idle");
  assert.equal(resolveOrbState({ messages: [], now: at, listening: true }), "listening");
  assert.equal(
    resolveOrbState({
      messages: [message({ role: "user", status: "pending" })],
      now: at,
      listening: true,
    }),
    "thinking",
  );
});

test("orb motion stops for reduced motion and a hidden tab", () => {
  assert.equal(orbMoves(false, false), true);
  assert.equal(orbMoves(true, false), false);
  assert.equal(orbMoves(false, true), false);
});
