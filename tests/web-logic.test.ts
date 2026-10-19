import assert from "node:assert/strict";
import { test } from "node:test";
import { addCivilDays, berlinParts, bucketTask, greeting, mondayOf, monthGrid } from "../src/web-logic/dates.ts";
import { allowPageDrag, dragAxis, swipeAxis, todoSwipeAction } from "../src/web-logic/gesture.ts";
import { createLiveState, reconnectDelayMs } from "../src/web-logic/live.ts";
import { parseMarkdown } from "../src/web-logic/markdown.ts";
import { parseSseBlock } from "../src/web-logic/sse.ts";

test("month grid starts on Monday and the Berlin week of 17 Oct 2026 does too", () => {
  const grid = monthGrid(2026, 10);
  assert.equal(grid[0]?.key, "2026-09-28");
  assert.equal(grid[0]?.inMonth, false);
  assert.equal(grid[3]?.key, "2026-10-01");
  assert.equal(grid[3]?.inMonth, true);
  assert.equal(grid.length % 7, 0);
  assert.equal(mondayOf("2026-10-17"), "2026-10-12");
  assert.equal(addCivilDays("2026-10-12", 6), "2026-10-18");
});

test("Berlin day keys follow the October 2026 clock change", () => {
  assert.equal(berlinParts(new Date("2026-10-24T22:00:00Z")).key, "2026-10-25");
  assert.equal(berlinParts(new Date("2026-10-25T23:00:00Z")).key, "2026-10-26");
  assert.equal(greeting(new Date("2026-10-19T07:30:00+02:00")), "Guten Morgen");
  assert.equal(greeting(new Date("2026-10-19T21:30:00+02:00")), "Guten Abend");
});

test("task buckets use the Berlin date and keep done tasks apart", () => {
  assert.equal(bucketTask({ status: "offen", faelligAm: "2026-10-18T18:00:00+02:00" }, "2026-10-19"), "overdue");
  assert.equal(bucketTask({ status: "offen", faelligAm: "2026-10-19T08:00:00+02:00" }, "2026-10-19"), "today");
  assert.equal(bucketTask({ status: "in Arbeit", faelligAm: "2026-10-21T08:00:00+02:00" }, "2026-10-19"), "soon");
  assert.equal(bucketTask({ status: "fehlgeschlagen" }, "2026-10-19"), "undated");
  assert.equal(bucketTask({ status: "erledigt", faelligAm: "2026-10-18T18:00:00+02:00" }, "2026-10-19"), "done");
});

test("swipes need a clear axis and ignore blocked targets", () => {
  assert.equal(swipeAxis(80, 10), "x");
  assert.equal(swipeAxis(10, 90), "y");
  assert.equal(swipeAxis(40, 30), "none");
  assert.equal(swipeAxis(80, 10, true), "none");
  assert.equal(dragAxis(20, 4), "x");
  assert.equal(todoSwipeAction(100), "done");
  assert.equal(todoSwipeAction(-100), "delete");
  assert.equal(todoSwipeAction(20), "none");
});

test("page drags stay off the calendar except at the screen edge", () => {
  const root = {
    closest(selector: string) {
      return selector.includes("calendar") ? root : null;
    },
  } as unknown as Element;
  const blocked = {
    closest(selector: string) {
      return selector.includes("data-no-swipe") ? blocked : null;
    },
  } as unknown as Element;
  assert.equal(allowPageDrag(root, 8, 390), true);
  assert.equal(allowPageDrag(root, 200, 390), false);
  assert.equal(allowPageDrag(root, 370, 390), true);
  assert.equal(allowPageDrag(blocked, 8, 390), false);
});

test("live state keeps the newest event id and asks for one resync", () => {
  const live = createLiveState();
  let calls = 0;
  live.subscribe(() => {
    calls += 1;
  });
  live.seen(4);
  live.seen(2);
  live.requestResync();
  live.requestResync();
  assert.equal(live.get().lastEventId, 4);
  assert.equal(live.get().resync, true);
  live.clearResync();
  live.setConnection("connected");
  assert.equal(live.get().connection, "connected");
  assert.equal(calls, 4);
  assert.equal(reconnectDelayMs(0), 1000);
  assert.equal(reconnectDelayMs(8), 30_000);
});

test("sse frames keep the id and skip heartbeats", () => {
  assert.equal(parseSseBlock(": ping"), null);
  const block = parseSseBlock('event: status:changed\ndata: {"id":2}\nid: 2');
  assert.equal(block?.event, "status:changed");
  assert.equal(block?.id, 2);
  assert.match(block?.data ?? "", /"id":2/);
  const resync = parseSseBlock("event: resync\ndata: {}\nid: 4");
  assert.equal(resync?.event, "resync");
});

test("markdown keeps raw html as text and only links http urls", () => {
  const blocks = parseMarkdown("Hallo **Levin**\n\n- <script>alert(1)</script>\n- [xAI](https://x.ai)\n- [no](javascript:alert(1))");
  assert.equal(blocks[0]?.type, "p");
  assert.equal(blocks[1]?.type, "ul");
  if (blocks[1]?.type !== "ul") {
    return;
  }
  assert.equal(blocks[1].items[0]?.[0]?.type, "text");
  assert.match(blocks[1].items[0]?.[0]?.type === "text" ? blocks[1].items[0][0].text : "", /<script>/);
  const link = blocks[1].items[1]?.find((part) => part.type === "link");
  assert.equal(link?.type === "link" ? link.href : "", "https://x.ai");
  assert.equal(blocks[1].items[2]?.some((part) => part.type === "link"), false);
});
