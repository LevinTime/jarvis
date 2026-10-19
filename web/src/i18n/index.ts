import { useEffect, useState } from "react";
import de from "./de.json" with { type: "json" };
import en from "./en.json" with { type: "json" };

export type LocaleId = "de" | "en";

const tables: Record<LocaleId, Record<string, string>> = { de, en };
let locale: LocaleId = "de";
const listeners = new Set<() => void>();

export function getLocale(): LocaleId {
  return locale;
}

export function setLocale(next: LocaleId): void {
  if (locale === next) {
    return;
  }
  locale = next;
  for (const listener of listeners) {
    listener();
  }
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = tables[locale][key] ?? tables.de[key] ?? key;
  if (!vars) {
    return raw;
  }
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

export function useI18n(): typeof t {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return t;
}
