import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  LAYOUT_VERSION,
  layoutsEqual,
  packLayouts,
  readDashboardLayouts,
  serializeDashboardLayouts,
  viewportBreakpoint,
} from "../src/web-logic/dashboard-layout.ts";
import { layoutDayBar, renderDayBar } from "../src/web-logic/day-timeline.ts";
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

test("day bar places blocks from 07 to 22 and marks now", () => {
  const bar = layoutDayBar({
    nowMin: 13 * 60 + 32,
    events: [
      { id: "pool", title: "Whirlpool", startMin: 15 * 60 },
      { id: "hens", title: "Hühner", startMin: 18 * 60 },
      { id: "early", title: "Früh", startMin: 6 * 60, endMin: 6 * 60 + 30 },
    ],
  });
  assert.deepEqual(bar.hours[0], 7);
  assert.equal(bar.hours.at(-1), 22);
  assert.equal(bar.blocks.some((block) => block.id === "early"), false);
  const pool = bar.blocks.find((block) => block.id === "pool");
  assert.ok(pool);
  assert.equal(pool.left, 53.33);
  assert.ok(bar.nowLeft !== null && bar.nowLeft > 40 && bar.nowLeft < 50);
  assert.equal(bar.next?.id, "pool");
  const html = renderDayBar(bar);
  assert.match(html, /class="day-block"/);
  assert.match(html, /class="day-now"/);
  assert.match(html, /Whirlpool/);
  assert.equal(renderDayBar(layoutDayBar({ nowMin: 23 * 60, events: [] })).includes("day-now"), false);
});

test("saved dashboard layout falls back when the value is broken or old", () => {
  const ids = ["status", "tasks", "events"];
  const defaults = packLayouts(ids);
  assert.equal(layoutsEqual(readDashboardLayouts(null, ids), defaults), true);
  assert.equal(layoutsEqual(readDashboardLayouts("not json", ids), defaults), true);
  assert.equal(layoutsEqual(readDashboardLayouts(JSON.stringify({ version: 0, layouts: {} }), ids), defaults), true);
  const broken = serializeDashboardLayouts(defaults).replace('"w":12', '"w":"wide"');
  assert.equal(layoutsEqual(readDashboardLayouts(broken, ids), defaults), true);

  const custom = packLayouts(ids);
  const moved = custom.lg[0];
  if (moved) {
    moved.x = 1;
  }
  const raw = JSON.stringify({ version: LAYOUT_VERSION, layouts: custom });
  const read = readDashboardLayouts(raw, [...ids, "notes"]);
  assert.equal(read.lg.find((tile) => tile.i === "status")?.x, 1);
  assert.equal(read.lg.some((tile) => tile.i === "notes"), true);
  assert.equal(read.lg.some((tile) => tile.i === "cost"), false);
  assert.equal(serializeDashboardLayouts(read).includes(`"version":${LAYOUT_VERSION}`), true);
});

test("each device width picks its own dashboard columns", () => {
  assert.equal(viewportBreakpoint(428), "sm");
  assert.equal(viewportBreakpoint(639), "sm");
  assert.equal(viewportBreakpoint(640), "md");
  assert.equal(viewportBreakpoint(1023), "md");
  assert.equal(viewportBreakpoint(1024), "lg");
  assert.equal(viewportBreakpoint(1920), "lg");
});

test("the shell keeps the iphone constraints and a centered desktop column", () => {
  const css = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.match(html, /viewport-fit=cover/);
  assert.equal(html.includes("maximum-scale"), false);
  assert.equal(html.includes("user-scalable"), false);
  assert.match(css, /100dvh/);
  assert.match(css, /display-mode:\s*standalone/);
  assert.match(css, /overscroll-behavior:\s*none/);
  assert.match(css, /font-size:\s*max\(16px,\s*1rem\)/);
  assert.match(css, /touch-action:\s*manipulation/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /1280px/);
});

test("orb motion stops for reduced motion and a hidden tab", () => {
  assert.equal(orbMoves(false, false), true);
  assert.equal(orbMoves(true, false), false);
  assert.equal(orbMoves(false, true), false);
});
