import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { MessageValidationError, createMessageStore } from "../src/messages/store.ts";

async function withStore(limits?: { rotateAt?: number; keep?: number; maxText?: number }) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-messages-"));
  const store = createMessageStore({ dataDir, ...limits });
  return {
    dataDir,
    store,
    async cleanup() {
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("messages append, list and paginate in chronological order", async () => {
  const ctx = await withStore();
  try {
    const first = await ctx.store.append({ source: "web", role: "user", text: "eins" });
    await ctx.store.append({ source: "web", role: "assistant", text: "zwei" });
    const third = await ctx.store.append({ source: "telegram", role: "user", text: "drei" });
    const page = await ctx.store.list({ before: third.message.id, limit: 1 });
    assert.equal(page.length, 1);
    assert.equal(page[0]?.text, "zwei");
    const after = await ctx.store.list({ since: first.message.id, limit: 10 });
    assert.deepEqual(after.map((message) => message.text), ["zwei", "drei"]);
  } finally {
    await ctx.cleanup();
  }
});

test("the same clientId is stored once", async () => {
  const ctx = await withStore();
  try {
    const first = await ctx.store.append({
      source: "web",
      role: "user",
      text: "Whirlpool",
      clientId: "client-1",
      status: "pending",
    });
    const second = await ctx.store.append({
      source: "web",
      role: "user",
      text: "nochmal",
      clientId: "client-1",
    });
    assert.equal(second.created, false);
    assert.equal(second.message.id, first.message.id);
    assert.equal((await ctx.store.list({ limit: 10 })).length, 1);
    assert.equal((await ctx.store.findByClientId("client-1"))?.text, "Whirlpool");
  } finally {
    await ctx.cleanup();
  }
});

test("parallel appends keep every message", async () => {
  const ctx = await withStore();
  try {
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        ctx.store.append({ source: "web", role: "user", text: `n${index}` }),
      ),
    );
    const listed = await ctx.store.list({ limit: 50 });
    assert.equal(listed.length, 20);
    assert.equal(new Set(listed.map((message) => message.id)).size, 20);
  } finally {
    await ctx.cleanup();
  }
});

test("a long message is rejected and old messages rotate into the archive", async () => {
  const ctx = await withStore({ rotateAt: 5, keep: 3, maxText: 20 });
  try {
    await assert.rejects(
      () => ctx.store.append({ source: "web", role: "user", text: "x".repeat(21) }),
      (error: unknown) => error instanceof MessageValidationError,
    );
    for (let index = 0; index < 6; index += 1) {
      await ctx.store.append({ source: "web", role: "user", text: `m${index}` });
    }
    const live = JSON.parse(await readFile(path.join(ctx.dataDir, "messages.json"), "utf8")) as Array<{
      text: string;
    }>;
    assert.deepEqual(live.map((message) => message.text), ["m3", "m4", "m5"]);
    const archived = await readdir(path.join(ctx.dataDir, "archive"));
    assert.equal(archived.length, 1);
    const old = JSON.parse(
      await readFile(path.join(ctx.dataDir, "archive", archived[0] ?? ""), "utf8"),
    ) as Array<{ text: string }>;
    assert.deepEqual(old.map((message) => message.text), ["m0", "m1", "m2"]);
  } finally {
    await ctx.cleanup();
  }
});

test("a legacy history file is imported once", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-migrate-"));
  try {
    await writeFile(
      path.join(dataDir, "history.json"),
      JSON.stringify([{ role: "user", content: "alter text", ts: "2026-10-01T10:00:00.000Z" }]),
      "utf8",
    );
    const store = createMessageStore({ dataDir });
    const listed = await store.list({ limit: 10 });
    assert.equal(listed[0]?.text, "alter text");
    assert.equal(listed[0]?.source, "system");
    const names = await readdir(dataDir);
    assert.equal(names.includes("history.json.migrated"), true);
    const again = createMessageStore({ dataDir });
    assert.equal((await again.list({ limit: 10 })).length, 1);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("updateStatus marks a pending message as error", async () => {
  const ctx = await withStore();
  try {
    const stored = await ctx.store.append({
      source: "web",
      role: "user",
      text: "hallo",
      status: "pending",
    });
    const updated = await ctx.store.updateStatus(stored.message.id, "error", "zu lang gedauert");
    assert.equal(updated.status, "error");
    assert.equal(updated.error, "zu lang gedauert");
  } finally {
    await ctx.cleanup();
  }
});
