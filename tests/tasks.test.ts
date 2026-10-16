import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  TaskConflictError,
  TaskNotFoundError,
  TaskValidationError,
  createTaskService,
} from "../src/tasks/service.ts";

type ServiceExtras = Omit<Parameters<typeof createTaskService>[0], "dataDir">;

async function withService(extras: ServiceExtras = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-tasks-"));
  const service = createTaskService({ dataDir, ...extras });
  return {
    service,
    dataDir,
    async cleanup() {
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

test("create stores a task as offen with timestamps", async () => {
  const { service, cleanup } = await withService();
  try {
    const task = await service.create({
      titel: "Hühner füttern",
      aufgabe: "abends Hühner füttern",
    });

    assert.equal(task.titel, "Hühner füttern");
    assert.equal(task.aufgabe, "abends Hühner füttern");
    assert.equal(task.status, "offen");
    assert.ok(task.id.length > 0);
    assert.ok(Date.parse(task.createdAt));
    assert.equal(task.createdAt, task.updatedAt);

    const loaded = await service.get(task.id);
    assert.deepEqual(loaded, task);
  } finally {
    await cleanup();
  }
});

test("create rejects empty titel or aufgabe", async () => {
  const { service, cleanup } = await withService();
  try {
    await assert.rejects(
      () => service.create({ titel: "  ", aufgabe: "etwas" }),
      TaskValidationError,
    );
    await assert.rejects(
      () => service.create({ titel: "etwas", aufgabe: "" }),
      TaskValidationError,
    );
  } finally {
    await cleanup();
  }
});

test("get throws when the task is missing", async () => {
  const { service, cleanup } = await withService();
  try {
    await assert.rejects(() => service.get("fehlt"), (error: unknown) => {
      assert.ok(error instanceof TaskNotFoundError);
      assert.equal(error.taskId, "fehlt");
      return true;
    });
  } finally {
    await cleanup();
  }
});

test("list returns created tasks", async () => {
  const { service, cleanup } = await withService();
  try {
    await service.create({
      id: "t1",
      titel: "Whirlpool",
      aufgabe: "Whirlpool sauber machen",
    });
    await service.create({
      id: "t2",
      titel: "Eltern",
      aufgabe: "Eltern abholen",
    });
    const listed = await service.list();
    assert.equal(listed.length, 2);
    assert.deepEqual(
      listed.map((task) => task.id),
      ["t1", "t2"],
    );
  } finally {
    await cleanup();
  }
});

test("run moves offen to in Arbeit then erledigt and writes the log", async () => {
  let seenStatus: string | undefined;
  const { service, cleanup } = await withService({
    processor: async (task) => {
      seenStatus = task.status;
      return "Hühner sind satt";
    },
  });
  try {
    const created = await service.create({
      titel: "Hühner füttern",
      aufgabe: "abends Hühner füttern",
    });
    const done = await service.run(created.id);

    assert.equal(seenStatus, "in Arbeit");
    assert.equal(done.status, "erledigt");
    assert.equal(done.result, "Hühner sind satt");
    assert.ok(done.startedAt);
    assert.ok(done.completedAt);
    assert.ok(Date.parse(done.startedAt ?? "") <= Date.parse(done.completedAt ?? ""));

    const log = await service.log(created.id);
    assert.deepEqual(
      log.map((entry) => entry.event),
      ["gestartet", "erledigt"],
    );
    assert.equal(log[0]?.status, "in Arbeit");
    assert.equal(log[1]?.status, "erledigt");
    assert.equal(log[1]?.message, "Hühner sind satt");
  } finally {
    await cleanup();
  }
});

test("run marks a thrown processor as fehlgeschlagen and logs the error", async () => {
  const { service, cleanup } = await withService({
    processor: async () => {
      throw new Error("kein Futter mehr");
    },
  });
  try {
    const created = await service.create({
      titel: "Hühner füttern",
      aufgabe: "abends Hühner füttern",
    });
    const failed = await service.run(created.id);

    assert.equal(failed.status, "fehlgeschlagen");
    assert.equal(failed.error, "kein Futter mehr");
    assert.ok(failed.failedAt);
    assert.equal(failed.result, undefined);

    const log = await service.log(created.id);
    assert.equal(log.at(-1)?.event, "fehlgeschlagen");
    assert.equal(log.at(-1)?.error, "kein Futter mehr");
  } finally {
    await cleanup();
  }
});

test("run refuses an already erledigten task", async () => {
  const { service, cleanup } = await withService();
  try {
    const created = await service.create({
      titel: "Whirlpool",
      aufgabe: "putzen",
    });
    await service.run(created.id);
    await assert.rejects(
      () => service.run(created.id),
      TaskConflictError,
    );
  } finally {
    await cleanup();
  }
});

test("a fehlgeschlagener task can be retried", async () => {
  let attempts = 0;
  const { service, cleanup } = await withService({
    processor: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("netz weg");
      }
      return "ok";
    },
  });
  try {
    const created = await service.create({
      titel: "Wetter",
      aufgabe: "Wetter für Issum holen",
    });
    const failed = await service.run(created.id);
    assert.equal(failed.status, "fehlgeschlagen");
    const done = await service.run(created.id);
    assert.equal(done.status, "erledigt");
    assert.equal(done.result, "ok");
    assert.equal(done.error, undefined);
  } finally {
    await cleanup();
  }
});

test("tasks persist for a new service on the same data dir", async () => {
  const { service, dataDir, cleanup } = await withService();
  try {
    const created = await service.create({
      titel: "Eltern",
      aufgabe: "morgen kommen die Eltern zurück",
    });
    const reloaded = createTaskService({ dataDir });
    const loaded = await reloaded.get(created.id);
    assert.equal(loaded.titel, "Eltern");
    assert.equal(loaded.status, "offen");
  } finally {
    await cleanup();
  }
});
