import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("create stores optional faelligAm and stays compatible without it", async () => {
  const { service, dataDir, cleanup } = await withService();
  try {
    const withDue = await service.create({
      id: "pool",
      titel: "Whirlpool",
      aufgabe: "putzen",
      faelligAm: "2026-10-17T20:00:00+02:00",
    });
    assert.equal(withDue.faelligAm, "2026-10-17T20:00:00+02:00");
    assert.equal((await service.get("pool")).faelligAm, "2026-10-17T20:00:00+02:00");

    const without = await service.create({
      titel: "Hühner füttern",
      aufgabe: "abends Hühner füttern",
    });
    assert.equal(without.faelligAm, undefined);

    await assert.rejects(
      () => service.create({ titel: "x", aufgabe: "y", faelligAm: "bald" }),
      TaskValidationError,
    );

    const reloaded = createTaskService({ dataDir });
    assert.equal((await reloaded.get("pool")).faelligAm, "2026-10-17T20:00:00+02:00");
  } finally {
    await cleanup();
  }
});

test("tasks without faelligAm in json still load", async () => {
  const { service, dataDir, cleanup } = await withService();
  try {
    const created = await service.create({
      titel: "Alt",
      aufgabe: "alte datei",
    });
    await writeFile(
      path.join(dataDir, "tasks.json"),
      `${JSON.stringify(
        [
          {
            id: created.id,
            titel: created.titel,
            aufgabe: created.aufgabe,
            status: "offen",
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
          },
        ],
        null,
        2,
      )}\n`,
      "utf8",
    );
    const loaded = await service.get(created.id);
    assert.equal(loaded.faelligAm, undefined);
    assert.equal(loaded.titel, "Alt");
  } finally {
    await cleanup();
  }
});

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

test("recoverStale fails tasks in Arbeit longer than max age and they can run again", async () => {
  const { service, dataDir, cleanup } = await withService();
  try {
    const created = await service.create({
      id: "stale",
      titel: "Whirlpool",
      aufgabe: "putzen",
    });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeFile(
      path.join(dataDir, "tasks.json"),
      `${JSON.stringify(
        [
          {
            ...created,
            status: "in Arbeit",
            startedAt: hourAgo,
            updatedAt: hourAgo,
          },
        ],
        null,
        2,
      )}\n`,
      "utf8",
    );

    const recovered = await service.recoverStale();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]?.status, "fehlgeschlagen");
    assert.equal(recovered[0]?.error, "abgebrochen");
    assert.equal((await service.get(created.id)).status, "fehlgeschlagen");

    const log = await service.log(created.id);
    assert.equal(log.at(-1)?.event, "fehlgeschlagen");
    assert.equal(log.at(-1)?.error, "abgebrochen");

    const done = await service.run(created.id);
    assert.equal(done.status, "erledigt");
  } finally {
    await cleanup();
  }
});

test("reset sets a hanging in-Arbeit task back to offen", async () => {
  const { service, dataDir, cleanup } = await withService();
  try {
    const created = await service.create({
      id: "hang",
      titel: "Hühner füttern",
      aufgabe: "abends füttern",
    });
    const startedAt = new Date().toISOString();
    await writeFile(
      path.join(dataDir, "tasks.json"),
      `${JSON.stringify(
        [
          {
            ...created,
            status: "in Arbeit",
            startedAt,
            updatedAt: startedAt,
          },
        ],
        null,
        2,
      )}\n`,
      "utf8",
    );

    const reset = await service.reset(created.id);
    assert.equal(reset.status, "offen");
    await assert.rejects(() => service.reset(created.id), TaskConflictError);

    const done = await service.run(created.id);
    assert.equal(done.status, "erledigt");
  } finally {
    await cleanup();
  }
});

test("a daily task spawns the next evening after it is done", async () => {
  const { service, cleanup } = await withService({
    now: () => new Date("2026-10-17T16:30:00.000Z"),
  });
  try {
    await service.create({
      id: "huehner",
      titel: "Hühner füttern",
      aufgabe: "jeden Abend Hühner füttern",
      faelligAm: "2026-10-17T18:00:00+02:00",
      wiederholung: "taeglich",
    });
    const done = await service.run("huehner");
    assert.equal(done.status, "erledigt");
    assert.equal(done.wiederholung, "taeglich");

    const listed = await service.list();
    assert.equal(listed.length, 2);
    const next = listed.find((task) => task.id !== "huehner");
    assert.equal(next?.status, "offen");
    assert.equal(next?.titel, "Hühner füttern");
    assert.equal(next?.aufgabe, "jeden Abend Hühner füttern");
    assert.equal(next?.wiederholung, "taeglich");
    assert.equal(next?.faelligAm, "2026-10-18T18:00:00+02:00");
  } finally {
    await cleanup();
  }
});

test("a weekly task is due again seven days later", async () => {
  const { service, cleanup } = await withService();
  try {
    await service.create({
      id: "woche",
      titel: "Hühner füttern",
      aufgabe: "jede Woche",
      faelligAm: "2026-10-17T18:00:00+02:00",
      wiederholung: "woechentlich",
    });
    await service.run("woche");
    const next = (await service.list()).find((task) => task.status === "offen");
    assert.equal(next?.faelligAm, "2026-10-24T18:00:00+02:00");
    assert.equal(next?.wiederholung, "woechentlich");
  } finally {
    await cleanup();
  }
});

test("a failed recurring task does not spawn and a bad repeat is rejected", async () => {
  const { service, cleanup } = await withService({
    processor: async () => {
      throw new Error("kein Futter");
    },
  });
  try {
    await service.create({
      id: "woche",
      titel: "Hühner füttern",
      aufgabe: "jede Woche",
      faelligAm: "2026-10-17T18:00:00+02:00",
      wiederholung: "woechentlich",
    });
    const failed = await service.run("woche");
    assert.equal(failed.status, "fehlgeschlagen");
    assert.equal((await service.list()).length, 1);

    await assert.rejects(
      () =>
        service.create({
          titel: "x",
          aufgabe: "y",
          wiederholung: "monatlich",
        }),
      TaskValidationError,
    );
  } finally {
    await cleanup();
  }
});

test("tasks without wiederholung stay a single instance", async () => {
  const { service, cleanup } = await withService();
  try {
    const created = await service.create({
      titel: "Einmal",
      aufgabe: "nur einmal",
      wiederholung: null,
    });
    assert.equal(created.wiederholung, undefined);
    await service.run(created.id);
    assert.equal((await service.list()).length, 1);
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
