import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  TranscriptNotFoundError,
  createTranscriptService,
} from "../src/transcripts/service.ts";

const SAMPLE = `# Gesprächsprotokoll Levin und Jarvis, Freitag, 16.10.2026

Zusammenfassung aus dem Chat, kein wörtliches Transkript.

| Uhrzeit | Sprecher | Text |
|---|---|---|
| 14:45 | Jarvis | Prompt für den Telegram-Bot geschrieben. |
| 14:58 | Levin | Task-Modul gebaut. |

## Entscheidungen
- Nächster Schritt: Transkript-Zugriff.
`;

async function withTranscripts() {
  const transcriptsDir = await mkdtemp(path.join(tmpdir(), "jarvis-transcripts-"));
  const service = createTranscriptService({ transcriptsDir });
  return {
    service,
    transcriptsDir,
    async cleanup() {
      await rm(transcriptsDir, { recursive: true, force: true });
    },
  };
}

test("list creates a missing transcripts dir and returns an empty list", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "jarvis-transcripts-parent-"));
  const transcriptsDir = path.join(parent, "transcripts");
  const service = createTranscriptService({ transcriptsDir });
  try {
    const listed = await service.list();
    assert.deepEqual(listed, []);
    const info = await stat(transcriptsDir);
    assert.equal(info.isDirectory(), true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("list and get parse uhrzeit, sprecher and text from markdown", async () => {
  const { service, transcriptsDir, cleanup } = await withTranscripts();
  try {
    await writeFile(path.join(transcriptsDir, "2026-10-16.md"), SAMPLE, "utf8");

    const listed = await service.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, "2026-10-16");
    assert.equal(
      listed[0]?.title,
      "Gesprächsprotokoll Levin und Jarvis, Freitag, 16.10.2026",
    );
    assert.equal(listed[0]?.entries.length, 2);
    assert.deepEqual(listed[0]?.entries[0], {
      uhrzeit: "14:45",
      sprecher: "Jarvis",
      text: "Prompt für den Telegram-Bot geschrieben.",
    });

    const loaded = await service.get("2026-10-16");
    assert.deepEqual(loaded, listed[0]);
    assert.equal(loaded.entries[1]?.sprecher, "Levin");
    assert.equal(loaded.entries[1]?.text, "Task-Modul gebaut.");
  } finally {
    await cleanup();
  }
});

test("get throws when the transcript is missing", async () => {
  const { service, cleanup } = await withTranscripts();
  try {
    await service.list();
    await assert.rejects(() => service.get("fehlt"), (error: unknown) => {
      assert.ok(error instanceof TranscriptNotFoundError);
      assert.equal(error.transcriptId, "fehlt");
      return true;
    });
  } finally {
    await cleanup();
  }
});

test("list skips non-markdown files and sorts by id", async () => {
  const { service, transcriptsDir, cleanup } = await withTranscripts();
  try {
    await writeFile(path.join(transcriptsDir, "notes.txt"), "kein protokoll", "utf8");
    await mkdir(path.join(transcriptsDir, "subdir"));
    await writeFile(
      path.join(transcriptsDir, "2026-10-17.md"),
      "# Später\n\n| Uhrzeit | Sprecher | Text |\n|---|---|---|\n| 09:00 | Levin | Zweiter Tag. |\n",
      "utf8",
    );
    await writeFile(
      path.join(transcriptsDir, "2026-10-16.md"),
      SAMPLE,
      "utf8",
    );

    const listed = await service.list();
    assert.deepEqual(
      listed.map((item) => item.id),
      ["2026-10-16", "2026-10-17"],
    );
  } finally {
    await cleanup();
  }
});
