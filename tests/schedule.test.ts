import assert from "node:assert/strict";
import { test } from "node:test";
import { nextOccurrence } from "../src/tasks/schedule.ts";

test("nextOccurrence adds one or seven Berlin days and keeps the clock time", () => {
  assert.equal(
    nextOccurrence("2026-10-17T18:00:00+02:00", "taeglich"),
    "2026-10-18T18:00:00+02:00",
  );
  assert.equal(
    nextOccurrence("2026-10-17T18:00:00+02:00", "woechentlich"),
    "2026-10-24T18:00:00+02:00",
  );
});

test("nextOccurrence keeps local time across the Berlin DST change", () => {
  assert.equal(
    nextOccurrence("2026-10-24T18:00:00+02:00", "taeglich"),
    "2026-10-25T18:00:00+01:00",
  );
  assert.equal(
    nextOccurrence("2026-03-28T18:00:00+01:00", "taeglich"),
    "2026-03-29T18:00:00+02:00",
  );
  assert.equal(
    nextOccurrence("2026-10-17T00:00:00+02:00", "taeglich"),
    "2026-10-18T00:00:00+02:00",
  );
});
