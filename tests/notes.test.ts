import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  NoteNotFoundError,
  NoteValidationError,
  createNoteService,
} from "../src/notes/service.ts";

async function withNotes() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-notes-"));
  const service = createNoteService({
    dataDir,
    now: () => new Date("2026-10-17T15:00:00.000Z"),
  });
  return {
    service,
    dataDir,
    async cleanup() {
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("add stores an open person note and keeps person optional", async () => {
  const { service, dataDir, cleanup } = await withNotes();
  try {
    const note = await service.add({
      id: "tim",
      person: " Tim ",
      text: "wollte ihm wegen Samstag noch antworten",
      erinnernAm: "2026-10-18T09:00:00+02:00",
    });
    assert.equal(note.person, "Tim");
    assert.equal(note.text, "wollte ihm wegen Samstag noch antworten");
    assert.equal(note.offen, true);
    assert.equal(note.erstelltAm, "2026-10-17T15:00:00.000Z");
    assert.equal(note.erinnernAm, "2026-10-18T09:00:00+02:00");

    const loose = await service.add({ text: "irgendwann den Stall fegen" });
    assert.equal(loose.person, undefined);
    assert.equal(loose.erinnernAm, undefined);
    assert.equal(loose.offen, true);

    const reloaded = createNoteService({ dataDir });
    assert.equal((await reloaded.get("tim")).person, "Tim");
    assert.deepEqual(
      (await reloaded.listOpen()).map((item) => item.id),
      ["tim", loose.id],
    );
  } finally {
    await cleanup();
  }
});

test("add rejects empty text and a bad erinnernAm", async () => {
  const { service, cleanup } = await withNotes();
  try {
    await assert.rejects(
      () => service.add({ text: "  " }),
      NoteValidationError,
    );
    await assert.rejects(
      () => service.add({ text: "Tim", erinnernAm: "samstag" }),
      NoteValidationError,
    );
  } finally {
    await cleanup();
  }
});

test("close marks a note done and a missing id throws", async () => {
  const { service, cleanup } = await withNotes();
  try {
    const note = await service.add({
      person: "Tim",
      text: "wegen Samstag antworten",
    });
    const closed = await service.close(note.id);
    assert.equal(closed.offen, false);
    assert.equal((await service.listOpen()).length, 0);
    assert.equal((await service.close(note.id)).offen, false);
    await assert.rejects(() => service.close("fehlt"), (error: unknown) => {
      assert.ok(error instanceof NoteNotFoundError);
      assert.equal(error.noteId, "fehlt");
      return true;
    });
  } finally {
    await cleanup();
  }
});
