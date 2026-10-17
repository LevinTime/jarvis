import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseJson, writeTextAtomic } from "../src/atomic-file.ts";
import { MissingConfigError, requireEnv } from "../src/load-env.ts";
import { formatLogLine } from "../src/log.ts";
import { createNoteService } from "../src/notes/service.ts";
import { createTaskService } from "../src/tasks/service.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("atomic write replaces JSON and leaves no temp file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jarvis-atomic-"));
  try {
    const file = path.join(dir, "tasks.json");
    await writeTextAtomic(file, `${JSON.stringify([{ id: "a" }], null, 2)}\n`);
    await writeTextAtomic(file, `${JSON.stringify([{ id: "b" }], null, 2)}\n`);
    const names = await readdir(dir);
    assert.deepEqual(names, ["tasks.json"]);
    const parsed = parseJson(await readFile(file, "utf8"), "tasks.json") as Array<{ id: string }>;
    assert.equal(parsed[0]?.id, "b");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("task and note stores survive a rewrite without temp files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jarvis-atomic-store-"));
  try {
    const tasks = createTaskService({ dataDir: dir });
    await tasks.create({ id: "pool", titel: "Whirlpool", aufgabe: "putzen" });
    await tasks.create({ id: "stall", titel: "Stall", aufgabe: "fegen" });
    const notes = createNoteService({ dataDir: dir });
    await notes.add({ id: "tim", person: "Tim", text: "antworten" });
    const names = await readdir(dir);
    assert.equal(names.some((name) => name.endsWith(".tmp")), false);
    assert.equal((await tasks.get("pool")).titel, "Whirlpool");
    assert.equal((await notes.get("tim")).offen, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("broken JSON and a BOM get a clear result", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jarvis-json-"));
  try {
    const tasks = createTaskService({ dataDir: dir });
    await writeFile(path.join(dir, "tasks.json"), "\uFEFF[]", "utf8");
    assert.deepEqual(await tasks.list(), []);
    await writeFile(path.join(dir, "tasks.json"), "{", "utf8");
    await assert.rejects(() => tasks.list(), /tasks.json ist kein gültiges JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("requireEnv names every missing key in one message", () => {
  assert.throws(
    () => requireEnv(["GROK_API_KEY", "TELEGRAM_BOT_TOKEN", "ALLOWED_CHAT_ID"], {
      GROK_API_KEY: "  ",
      ALLOWED_CHAT_ID: "123",
    }),
    (error: unknown) => {
      assert.ok(error instanceof MissingConfigError);
      assert.deepEqual(error.missing, ["GROK_API_KEY", "TELEGRAM_BOT_TOKEN"]);
      assert.match(error.message, /GROK_API_KEY, TELEGRAM_BOT_TOKEN/);
      assert.match(error.message, /config\/\.env\.example/);
      return true;
    },
  );
  const present = requireEnv(["GROK_API_KEY"], { GROK_API_KEY: " test-key " });
  assert.equal(present.GROK_API_KEY, "test-key");
});

test("log lines start with an ISO timestamp", () => {
  assert.equal(
    formatLogLine("Jarvis-Bot läuft.", new Date("2026-10-17T16:00:00.000Z")),
    "2026-10-17T16:00:00.000Z Jarvis-Bot läuft.",
  );
});

test("the bot exits cleanly when .env keys are missing", async () => {
  const tsx = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsx, path.join(projectRoot, "src", "bot", "index.ts")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      GROK_API_KEY: "",
      TELEGRAM_BOT_TOKEN: "",
      ALLOWED_CHAT_ID: "",
    },
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`bot did not exit. stderr: ${stderr}`));
    }, 15000);
    child.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode ?? 1);
    });
  });
  assert.equal(code, 1);
  assert.match(
    stderr,
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z Diese Werte fehlen in \.env: GROK_API_KEY, TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_ID/,
  );
  assert.match(stderr, /config\/\.env\.example/);
  assert.doesNotMatch(stderr, /\n\s+at /);
});
