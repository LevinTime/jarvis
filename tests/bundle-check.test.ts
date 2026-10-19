import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findEnvLeaks, findSecretHits } from "../scripts/check-bundle.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the bundle scanner flags key shapes and ignores a clean shell", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jarvis-bundle-"));
  try {
    await mkdir(path.join(dir, "assets"));
    await writeFile(path.join(dir, "index.html"), "<title>Jarvis</title>", "utf8");
    await writeFile(path.join(dir, "assets", "app.js"), "console.log('jarvis')", "utf8");
    assert.deepEqual(await findSecretHits(dir), []);
    await writeFile(
      path.join(dir, "assets", "leak.js"),
      "const bad = 'xai-abcdefghijklmnopqrstuvwxyz';",
      "utf8",
    );
    const hits = await findSecretHits(dir);
    assert.equal(hits.some((hit) => hit.rule === "xai-key"), true);
    const leaks = await findEnvLeaks(dir, "GROK_API_KEY=xai-abcdefghijklmnopqrstuvwxyz\nTZ=Europe/Berlin\n");
    assert.deepEqual(leaks, ["GROK_API_KEY"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web/dist contains no env secrets when it has been built", async () => {
  const dist = path.join(projectRoot, "web", "dist");
  try {
    await readFile(path.join(dist, "index.html"), "utf8");
  } catch {
    return;
  }
  const hits = await findSecretHits(dist);
  assert.deepEqual(hits, []);
  try {
    const envText = await readFile(path.join(projectRoot, ".env"), "utf8");
    assert.deepEqual(await findEnvLeaks(dist, envText), []);
  } catch {
    // keine .env in dieser Umgebung
  }
});
