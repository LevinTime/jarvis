import path from "node:path";
import { parseJson, readText, writeTextAtomic } from "../atomic-file.ts";
import { logInfo } from "../log.ts";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  normalizeSettings,
  readDefaultT3Url,
} from "./model.ts";

export type SettingsStore = {
  get: () => Promise<AppSettings>;
  save: (input: unknown) => Promise<AppSettings>;
  effectiveT3Url: () => Promise<string>;
  defaultT3Url: () => string;
};

export function createSettingsStore(options: { file: string; defaultT3Url?: string }): SettingsStore {
  const fallbackUrl = readDefaultT3Url(options.defaultT3Url);
  let chain = Promise.resolve();
  let cache: AppSettings | null = null;

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function read(): Promise<AppSettings> {
    if (cache) {
      return cache;
    }
    try {
      const parsed = parseJson(await readText(options.file), "settings.json");
      cache = normalizeSettings(parsed, DEFAULT_SETTINGS);
    } catch (error) {
      const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
      if (!missing) {
        logInfo("Einstellungen sind ungültig. Es gilt das Standardlayout.");
      }
      cache = {
        ...DEFAULT_SETTINGS,
        widgets: DEFAULT_SETTINGS.widgets.map((item) => ({ ...item })),
      };
    }
    return cache;
  }

  return {
    defaultT3Url: () => fallbackUrl,
    get: () => enqueue(read),
    effectiveT3Url: () =>
      enqueue(async () => {
        const current = await read();
        return current.t3Url || fallbackUrl;
      }),
    save: (input) =>
      enqueue(async () => {
        const current = await read();
        const next = normalizeSettings(input, current);
        cache = next;
        await writeTextAtomic(options.file, `${JSON.stringify(next, null, 2)}\n`);
        return next;
      }),
  };
}

export function settingsPath(dataDir: string): string {
  return path.join(dataDir, "settings.json");
}
