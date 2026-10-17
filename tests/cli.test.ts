import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "../src/cli.ts";

async function withCli() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-cli-"));
  const transcriptsDir = await mkdtemp(path.join(tmpdir(), "jarvis-cli-tr-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const run = async (argv: string[]) => {
    const code = await runCli(argv, {
      dataDir,
      transcriptsDir,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    return { code, stdout: stdout.splice(0), stderr: stderr.splice(0) };
  };
  return {
    run,
    transcriptsDir,
    async cleanup() {
      await rm(dataDir, { recursive: true, force: true });
      await rm(transcriptsDir, { recursive: true, force: true });
    },
  };
}

test("CLI can add and get a task", async () => {
  const { run, cleanup } = await withCli();
  try {
    const added = await run([
      "add",
      "--titel",
      "Hühner füttern",
      "--aufgabe",
      "abends Hühner füttern",
    ]);
    assert.equal(added.code, 0);
    assert.match(added.stdout[0] ?? "", /^angelegt  /);

    const id = added.stdout[0]?.split(/\s+/)[1];
    assert.ok(id);

    const got = await run(["get", id]);
    assert.equal(got.code, 0);
    assert.match(got.stdout.join("\n"), /titel: Hühner füttern/);
    assert.match(got.stdout.join("\n"), /status: offen/);
  } finally {
    await cleanup();
  }
});

test("CLI add accepts a JSON object", async () => {
  const { run, cleanup } = await withCli();
  try {
    const added = await run([
      "add",
      "--json",
      JSON.stringify({
        id: "pool",
        titel: "Whirlpool",
        aufgabe: "heute noch Whirlpool sauber machen",
      }),
    ]);
    assert.equal(added.code, 0);
    assert.match(added.stdout[0] ?? "", /angelegt  pool  offen  Whirlpool/);

    const listed = await run(["list"]);
    assert.equal(listed.code, 0);
    assert.match(listed.stdout[0] ?? "", /pool  offen  Whirlpool/);
  } finally {
    await cleanup();
  }
});

test("CLI run completes a task and writes log lines", async () => {
  const { run, cleanup } = await withCli();
  try {
    const added = await run([
      "add",
      "--id",
      "huehner",
      "--titel",
      "Hühner füttern",
      "--aufgabe",
      "abends Hühner füttern",
    ]);
    assert.equal(added.code, 0);

    const ran = await run(["run", "huehner"]);
    assert.equal(ran.code, 0);
    assert.match(ran.stdout[0] ?? "", /^erledigt  huehner/);

    const got = await run(["get", "huehner"]);
    assert.match(got.stdout.join("\n"), /status: erledigt/);

    const log = await run(["log", "huehner"]);
    assert.equal(log.code, 0);
    assert.ok(log.stdout.some((line) => line.includes("gestartet")));
    assert.ok(log.stdout.some((line) => line.includes("erledigt")));
  } finally {
    await cleanup();
  }
});

test("CLI lists and shows a transcript", async () => {
  const { run, transcriptsDir, cleanup } = await withCli();
  try {
    await writeFile(
      path.join(transcriptsDir, "2026-10-16.md"),
      [
        "# Gesprächsprotokoll Levin und Jarvis, Freitag, 16.10.2026",
        "",
        "| Uhrzeit | Sprecher | Text |",
        "|---|---|---|",
        "| 14:45 | Jarvis | Prompt für den Telegram-Bot geschrieben. |",
        "| 14:58 | Levin | Task-Modul gebaut. |",
        "",
      ].join("\n"),
      "utf8",
    );

    const listed = await run(["transcripts"]);
    assert.equal(listed.code, 0);
    assert.match(
      listed.stdout[0] ?? "",
      /2026-10-16  Gesprächsprotokoll Levin und Jarvis, Freitag, 16.10.2026  \(2\)/,
    );

    const shown = await run(["transcript", "2026-10-16"]);
    assert.equal(shown.code, 0);
    assert.match(shown.stdout.join("\n"), /14:45  Jarvis  Prompt für den Telegram-Bot geschrieben\./);
    assert.match(shown.stdout.join("\n"), /14:58  Levin  Task-Modul gebaut\./);

    const missing = await run(["transcript", "fehlt"]);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr.join("\n"), /Transkript nicht gefunden: fehlt/);
  } finally {
    await cleanup();
  }
});

test("CLI list does not create the transcripts dir", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-cli-"));
  const parent = await mkdtemp(path.join(tmpdir(), "jarvis-cli-tr-parent-"));
  const transcriptsDir = path.join(parent, "missing-transcripts");
  const stdout: string[] = [];
  try {
    const code = await runCli(["list"], {
      dataDir,
      transcriptsDir,
      stdout: (line) => stdout.push(line),
      stderr: () => {},
    });
    assert.equal(code, 0);
    assert.equal(stdout[0], "keine tasks");
    await assert.rejects(() => stat(transcriptsDir), (error: unknown) => {
      assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
    await rm(parent, { recursive: true, force: true });
  }
});

test("CLI add stores faelligAm", async () => {
  const { run, cleanup } = await withCli();
  try {
    const added = await run([
      "add",
      "--id",
      "pool",
      "--titel",
      "Whirlpool",
      "--aufgabe",
      "putzen",
      "--faelligAm",
      "2026-10-17T20:00:00+02:00",
    ]);
    assert.equal(added.code, 0);
    const got = await run(["get", "pool"]);
    assert.match(got.stdout.join("\n"), /faelligAm: 2026-10-17T20:00:00\+02:00/);
  } finally {
    await cleanup();
  }
});

test("CLI stores a daily repeat and prints the next instance after run", async () => {
  const { run, cleanup } = await withCli();
  try {
    const added = await run([
      "add",
      "--id",
      "huehner",
      "--titel",
      "Hühner füttern",
      "--aufgabe",
      "jeden Abend Hühner füttern",
      "--faelligAm",
      "2026-10-17T18:00:00+02:00",
      "--wiederholung",
      "taeglich",
    ]);
    assert.equal(added.code, 0);
    const got = await run(["get", "huehner"]);
    assert.match(got.stdout.join("\n"), /wiederholung: taeglich/);

    const ran = await run(["run", "huehner"]);
    assert.equal(ran.code, 0);
    assert.match(ran.stdout[0] ?? "", /^erledigt  huehner/);
    assert.match(
      ran.stdout[1] ?? "",
      /^nächste  .+  taeglich  2026-10-18T18:00:00\+02:00$/,
    );
  } finally {
    await cleanup();
  }
});

test("CLI get reports a missing task", async () => {
  const { run, cleanup } = await withCli();
  try {
    const got = await run(["get", "fehlt"]);
    assert.equal(got.code, 1);
    assert.match(got.stderr.join("\n"), /Task nicht gefunden: fehlt/);
  } finally {
    await cleanup();
  }
});
