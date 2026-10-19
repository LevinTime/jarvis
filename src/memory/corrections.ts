import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseJson, readText, writeTextAtomic } from "../atomic-file.ts";
import { logError } from "../log.ts";
import { createMutex } from "../mutex.ts";
import { assertNoSecret, MemoryValidationError } from "./model.ts";
import type { MemoryStore } from "./store.ts";

export type Correction = {
  id: string;
  frage: string;
  falscheAntwort: string;
  korrektur: string;
  datum: string;
  quelle: "telegram" | "web";
};

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 1)}…`;
}

export function correctionFactText(input: { falscheAntwort: string; korrektur: string }): string {
  return `Korrektur: „${clip(input.falscheAntwort, 180)}“ stimmt nicht. ${clip(input.korrektur, 240)}`;
}

export function correctionsThisMonth(
  rows: Correction[],
  now: Date,
  timeZone = "Europe/Berlin",
): number {
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).format(now).slice(0, 7);
  return rows.filter((row) => {
    const stamp = new Date(row.datum);
    if (!Number.isFinite(stamp.getTime())) {
      return false;
    }
    const key = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    }).format(stamp).slice(0, 7);
    return key === month;
  }).length;
}

export function createCorrectionStore(options: {
  dataDir: string;
  memory: MemoryStore;
  now?: () => Date;
}) {
  const file = path.join(options.dataDir, "corrections.json");
  const mutex = createMutex();
  const nowIso = () => (options.now ?? (() => new Date()))().toISOString();

  async function load(): Promise<Correction[]> {
    try {
      const parsed = parseJson(await readText(file), "corrections.json");
      if (!Array.isArray(parsed)) {
        throw new Error("corrections.json ist kein Array");
      }
      return parsed as Correction[];
    } catch (error) {
      if (isEnoent(error)) {
        return [];
      }
      logError("Korrekturen sind ungültig. Es gilt eine leere Liste.", error);
      return [];
    }
  }

  async function add(input: {
    frage: string;
    falscheAntwort: string;
    korrektur: string;
    quelle: "telegram" | "web";
  }): Promise<Correction> {
    const falscheAntwort = input.falscheAntwort.trim();
    const korrektur = input.korrektur.trim() || "als falsch markiert";
    const frage = input.frage.trim();
    if (!falscheAntwort) {
      throw new MemoryValidationError("falsche Antwort fehlt");
    }
    assertNoSecret(`${frage}\n${falscheAntwort}\n${korrektur}`);
    const factText = correctionFactText({ falscheAntwort, korrektur });
    assertNoSecret(factText);
    return mutex.exclusive(async () => {
      const rows = await load();
      const existing = rows.find(
        (row) => row.falscheAntwort === falscheAntwort && row.korrektur === korrektur,
      );
      if (existing) {
        return existing;
      }
      const row: Correction = {
        id: randomUUID(),
        frage,
        falscheAntwort,
        korrektur,
        datum: nowIso(),
        quelle: input.quelle,
      };
      rows.push(row);
      await writeTextAtomic(file, `${JSON.stringify(rows, null, 2)}\n`);
      await options.memory.remember({
        text: factText,
        kategorie: "korrektur",
        quelle: input.quelle === "telegram" ? "telegram" : "web",
        wichtigkeit: 3,
      });
      return row;
    });
  }

  async function list(): Promise<Correction[]> {
    return mutex.exclusive(() => load());
  }

  return { add, list };
}

export type CorrectionStore = ReturnType<typeof createCorrectionStore>;
