import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runCli } from "../src/cli.ts";

async function withCli() {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-cli-"));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const run = async (argv: string[]) => {
    const code = await runCli(argv, {
      dataDir,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    return { code, stdout: stdout.splice(0), stderr: stderr.splice(0) };
  };
  return {
    run,
    async cleanup() {
      await rm(dataDir, { recursive: true, force: true });
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
