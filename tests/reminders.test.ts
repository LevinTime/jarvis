import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createTaskService, type Task } from "../src/tasks/service.ts";
import {
  findDueOpenTasks,
  runReminderTick,
  shouldSendDailyOverview,
} from "../src/bot/reminders.ts";

const due = "2026-10-17T18:00:00+02:00";

function task(overrides: Partial<Task> & Pick<Task, "id" | "titel">): Task {
  return {
    aufgabe: overrides.aufgabe ?? overrides.titel,
    status: "offen",
    createdAt: "2026-10-17T10:00:00.000Z",
    updatedAt: "2026-10-17T10:00:00.000Z",
    faelligAm: due,
    ...overrides,
  };
}

test("findDueOpenTasks returns open due tasks once per faelligAm", () => {
  const now = new Date("2026-10-17T16:30:00.000Z");
  const openDue = task({ id: "a", titel: "Hühner füttern" });
  const future = task({
    id: "b",
    titel: "Morgen",
    faelligAm: "2026-10-18T18:00:00+02:00",
  });
  const done = task({ id: "c", titel: "Fertig", status: "erledigt" });
  const noDue = task({ id: "d", titel: "Irgendwann", faelligAm: undefined });

  const first = findDueOpenTasks([openDue, future, done, noDue], now, {});
  assert.deepEqual(
    first.map((item) => item.id),
    ["a"],
  );

  const second = findDueOpenTasks([openDue], now, { a: due });
  assert.deepEqual(second, []);

  const moved = findDueOpenTasks(
    [{ ...openDue, faelligAm: "2026-10-17T18:15:00+02:00" }],
    now,
    { a: due },
  );
  assert.equal(moved[0]?.id, "a");
});

test("shouldSendDailyOverview fires once during the 8 o'clock Berlin hour", () => {
  const eight = new Date("2026-10-17T06:00:00.000Z");
  const eightThirty = new Date("2026-10-17T06:30:00.000Z");
  const nine = new Date("2026-10-17T07:00:00.000Z");

  assert.equal(shouldSendDailyOverview(eight, undefined), true);
  assert.equal(shouldSendDailyOverview(eightThirty, undefined), true);
  assert.equal(shouldSendDailyOverview(eight, "2026-10-17"), false);
  assert.equal(shouldSendDailyOverview(nine, undefined), false);
});

test("runReminderTick sends a due task once and the morning overview once", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-reminders-"));
  const tasks = createTaskService({ dataDir });
  const sent: string[] = [];
  try {
    await tasks.create({
      id: "huehner",
      titel: "Hühner füttern",
      aufgabe: "abends Hühner füttern",
      faelligAm: "2026-10-17T07:00:00+02:00",
    });

    const now = new Date("2026-10-17T06:05:00.000Z");
    await runReminderTick({
      tasks,
      dataDir,
      now,
      send: async (text) => {
        sent.push(text);
      },
    });
    await runReminderTick({
      tasks,
      dataDir,
      now,
      send: async (text) => {
        sent.push(text);
      },
    });

    assert.equal(sent.length, 2);
    assert.match(sent[0] ?? "", /Erinnerung: Hühner füttern/);
    assert.match(sent[1] ?? "", /Guten Morgen/);
    assert.match(sent[1] ?? "", /Hühner füttern/);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
