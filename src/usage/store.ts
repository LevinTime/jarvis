import path from "node:path";
import { parseJson, readText, writeTextAtomic } from "../atomic-file.ts";
import { createMutex } from "../mutex.ts";
import { aggregateUsage, type UsageRange, type UsageReport } from "./cost.ts";
import type { UsageDraft, UsageEntry } from "./types.ts";

type UsageStoreOptions = {
  dataDir: string;
  now?: () => Date;
  timeZone?: string;
  budgetUsd?: number | null;
};

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createUsageStore(options: UsageStoreOptions) {
  const file = path.join(options.dataDir, "usage.json");
  const mutex = createMutex();
  const nowIso = () => (options.now ?? (() => new Date()))().toISOString();
  const timeZone = options.timeZone ?? "Europe/Berlin";

  async function readAll(): Promise<UsageEntry[]> {
    try {
      const raw = await readText(file);
      const parsed = parseJson(raw, "usage.json");
      if (!Array.isArray(parsed)) {
        throw new Error("usage.json ist kein Array");
      }
      return parsed as UsageEntry[];
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  async function append(draft: UsageDraft): Promise<UsageEntry> {
    const entry: UsageEntry = {
      ts: draft.ts ?? nowIso(),
      model: draft.model,
      promptTokens: draft.ok ? draft.promptTokens : 0,
      completionTokens: draft.ok ? draft.completionTokens : 0,
      source: draft.source,
      purpose: draft.purpose,
      ok: draft.ok,
      ...(draft.ok && draft.cachedTokens !== undefined ? { cachedTokens: draft.cachedTokens } : {}),
      ...(!draft.ok && draft.error ? { error: draft.error } : {}),
    };
    await mutex.exclusive(async () => {
      const entries = await readAll();
      entries.push(entry);
      await writeTextAtomic(file, `${JSON.stringify(entries, null, 2)}\n`);
    });
    return entry;
  }

  async function report(range: UsageRange = "month", now = options.now?.() ?? new Date()): Promise<UsageReport> {
    const entries = await mutex.exclusive(() => readAll());
    return aggregateUsage({
      entries,
      now,
      timeZone,
      budgetUsd: options.budgetUsd ?? null,
      range,
    });
  }

  function setBudget(budgetUsd: number | null): void {
    options.budgetUsd = budgetUsd;
  }

  return { append, report, setBudget, drain: () => mutex.drain() };
}

export type UsageStore = ReturnType<typeof createUsageStore>;
