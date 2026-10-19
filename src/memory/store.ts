import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseJson, readText, writeTextAtomic } from "../atomic-file.ts";
import { logError } from "../log.ts";
import { createMutex } from "../mutex.ts";
import {
  assertNoSecret,
  findSimilar,
  isCategory,
  isImportance,
  isSource,
  renderMemoryMarkdown,
  selectMemory,
  type MemoryCategory,
  type MemoryFact,
  type MemoryImportance,
  type MemorySource,
  MemoryNotFoundError,
  MemoryValidationError,
} from "./model.ts";

export const BUDGET_FACT = "Levin ist budgetbewusst und bezieht ALG I.";

export type RememberInput = {
  text: string;
  kategorie?: MemoryCategory;
  quelle: MemorySource;
  wichtigkeit?: MemoryImportance;
};

export type MemoryUpdate = {
  text?: string;
  kategorie?: MemoryCategory;
  wichtigkeit?: MemoryImportance;
  aktiv?: boolean;
};

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function cleanText(value: string): string {
  const text = value.trim();
  if (!text) {
    throw new MemoryValidationError("text darf nicht leer sein");
  }
  if (text.length > 500) {
    throw new MemoryValidationError("text ist zu lang");
  }
  assertNoSecret(text);
  return text;
}

export function createMemoryStore(options: { dataDir: string; now?: () => Date }) {
  const file = path.join(options.dataDir, "memory.json");
  const markdown = path.join(options.dataDir, "memory.md");
  const mutex = createMutex();
  const nowIso = () => (options.now ?? (() => new Date()))().toISOString();

  async function load(): Promise<MemoryFact[]> {
    try {
      const parsed = parseJson(await readText(file), "memory.json");
      if (!Array.isArray(parsed)) {
        throw new Error("memory.json ist kein Array");
      }
      return parsed as MemoryFact[];
    } catch (error) {
      if (isEnoent(error)) {
        return [];
      }
      logError("Gedächtnis ist ungültig. Es gilt eine leere Liste.", error);
      return [];
    }
  }

  async function save(facts: MemoryFact[]): Promise<void> {
    await writeTextAtomic(file, `${JSON.stringify(facts, null, 2)}\n`);
    await writeTextAtomic(markdown, renderMemoryMarkdown(facts));
  }

  async function remember(input: RememberInput): Promise<MemoryFact> {
    const text = cleanText(input.text);
    const kategorie = input.kategorie ?? "regel";
    const wichtigkeit = input.wichtigkeit ?? 2;
    if (!isCategory(kategorie) || !isImportance(wichtigkeit) || !isSource(input.quelle)) {
      throw new MemoryValidationError("Gedächtnis-Eintrag ist ungültig");
    }
    return mutex.exclusive(async () => {
      const facts = await load();
      const now = nowIso();
      const match = findSimilar(facts, text);
      if (match?.kind === "same") {
        match.fact.zuletztBestätigt = now;
        if (wichtigkeit > match.fact.wichtigkeit) {
          match.fact.wichtigkeit = wichtigkeit;
        }
        await save(facts);
        return match.fact;
      }
      if (match?.kind === "conflict") {
        const previous = match.fact.text;
        match.fact.verlauf = [...(match.fact.verlauf ?? []), { text: previous, ersetztAm: now }];
        match.fact.text = text;
        match.fact.kategorie = kategorie;
        match.fact.wichtigkeit = wichtigkeit;
        match.fact.zuletztBestätigt = now;
        match.fact.quelle = input.quelle;
        await save(facts);
        return match.fact;
      }
      const fact: MemoryFact = {
        id: randomUUID(),
        text,
        kategorie,
        quelle: input.quelle,
        erstelltAm: now,
        zuletztBestätigt: now,
        wichtigkeit,
        aktiv: true,
      };
      facts.push(fact);
      await save(facts);
      return fact;
    });
  }

  async function update(id: string, patch: MemoryUpdate): Promise<MemoryFact> {
    return mutex.exclusive(async () => {
      const facts = await load();
      const fact = facts.find((item) => item.id === id);
      if (!fact) {
        throw new MemoryNotFoundError(id);
      }
      const now = nowIso();
      if (patch.text !== undefined) {
        const text = cleanText(patch.text);
        if (normalizeChanged(fact.text, text)) {
          fact.verlauf = [...(fact.verlauf ?? []), { text: fact.text, ersetztAm: now }];
          fact.text = text;
        }
      }
      if (patch.kategorie !== undefined) {
        if (!isCategory(patch.kategorie)) {
          throw new MemoryValidationError("Kategorie ist ungültig");
        }
        fact.kategorie = patch.kategorie;
      }
      if (patch.wichtigkeit !== undefined) {
        if (!isImportance(patch.wichtigkeit)) {
          throw new MemoryValidationError("Wichtigkeit ist ungültig");
        }
        fact.wichtigkeit = patch.wichtigkeit;
      }
      if (patch.aktiv !== undefined) {
        fact.aktiv = patch.aktiv;
      }
      fact.zuletztBestätigt = now;
      await save(facts);
      return fact;
    });
  }

  async function forget(id: string): Promise<MemoryFact> {
    return update(id, { aktiv: false });
  }

  async function search(query: string): Promise<MemoryFact[]> {
    const needle = query.trim().toLowerCase();
    const facts = (await list()).filter((fact) => fact.aktiv);
    if (!needle) {
      return facts;
    }
    return facts.filter((fact) => fact.text.toLowerCase().includes(needle));
  }

  async function list(): Promise<MemoryFact[]> {
    return mutex.exclusive(() => load());
  }

  async function relevant(query: string): Promise<MemoryFact[]> {
    return selectMemory(await list(), query);
  }

  async function seedBudgetFact(): Promise<void> {
    await mutex.exclusive(async () => {
      try {
        await readText(file);
        return;
      } catch (error) {
        if (!isEnoent(error)) {
          throw error;
        }
      }
    });
    try {
      await readText(file);
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
      await remember({
        text: BUDGET_FACT,
        kategorie: "regel",
        quelle: "manuell",
        wichtigkeit: 3,
      });
    }
  }

  return { remember, update, forget, search, list, relevant, seedBudgetFact };
}

function normalizeChanged(previous: string, next: string): boolean {
  return previous.trim() !== next.trim();
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
