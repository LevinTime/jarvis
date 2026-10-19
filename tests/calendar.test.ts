import assert from "node:assert/strict";
import { test } from "node:test";
import { expandTasks, filterTasks } from "../src/tasks/calendar.ts";
import { dayKey, isoInZone, startOfWeek } from "../src/tasks/schedule.ts";
import type { Task } from "../src/tasks/service.ts";

function task(overrides: Partial<Task> & Pick<Task, "id" | "faelligAm">): Task {
  return {
    titel: overrides.titel ?? overrides.id,
    aufgabe: overrides.aufgabe ?? overrides.id,
    status: overrides.status ?? "offen",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

test("isoInZone keeps the Berlin clock across the DST change", () => {
  assert.equal(isoInZone("2026-10-24T18:00"), "2026-10-24T18:00:00+02:00");
  assert.equal(isoInZone("2026-10-25T18:00"), "2026-10-25T18:00:00+01:00");
  assert.equal(isoInZone("2026-03-28T18:00"), "2026-03-28T18:00:00+01:00");
  assert.equal(isoInZone("2026-03-29T18:00"), "2026-03-29T18:00:00+02:00");
});

test("open daily tasks expand through the Berlin DST weekend", () => {
  const autumn = expandTasks(
    [
      task({
        id: "futter",
        faelligAm: "2026-10-24T18:00:00+02:00",
        wiederholung: "taeglich",
      }),
    ],
    "2026-10-24T00:00:00+02:00",
    "2026-10-26T00:00:00+01:00",
  );
  assert.deepEqual(
    autumn.map((item) => item.faelligAm),
    ["2026-10-24T18:00:00+02:00", "2026-10-25T18:00:00+01:00"],
  );
  assert.equal(autumn[1]?.projected, true);

  const spring = expandTasks(
    [
      task({
        id: "frueh",
        faelligAm: "2026-03-28T18:00:00+01:00",
        wiederholung: "taeglich",
      }),
    ],
    "2026-03-28T00:00:00+01:00",
    "2026-03-30T00:00:00+02:00",
  );
  assert.deepEqual(
    spring.map((item) => item.faelligAm),
    ["2026-03-28T18:00:00+01:00", "2026-03-29T18:00:00+02:00"],
  );
});

test("a finished recurring task does not project a second future", () => {
  const items = expandTasks(
    [
      task({
        id: "alt",
        status: "erledigt",
        faelligAm: "2026-10-17T18:00:00+02:00",
        wiederholung: "taeglich",
      }),
      task({
        id: "neu",
        faelligAm: "2026-10-18T18:00:00+02:00",
        wiederholung: "taeglich",
      }),
    ],
    "2026-10-17T00:00:00+02:00",
    "2026-10-20T00:00:00+02:00",
  );
  const eighteenth = items.filter((item) => item.faelligAm.startsWith("2026-10-18"));
  assert.equal(eighteenth.length, 1);
  assert.equal(eighteenth[0]?.taskId, "neu");
});

test("week filter starts on Monday in Berlin", () => {
  const monday = startOfWeek(new Date("2026-10-17T12:00:00+02:00"));
  assert.equal(dayKey(monday), "2026-10-12");
  const tasks = [
    task({ id: "samstag", faelligAm: "2026-10-17T18:00:00+02:00" }),
    task({ id: "danach", faelligAm: "2026-10-19T09:00:00+02:00" }),
  ];
  const week = filterTasks(tasks, { faellig: "woche" }, new Date("2026-10-17T12:00:00+02:00"));
  assert.deepEqual(week.map((item) => item.id), ["samstag"]);
});
