export const THEME_IDS = ["midnight", "ocean", "aurora", "graphite", "light"] as const;
export const DENSITY_IDS = ["compact", "normal", "airy"] as const;
export const LOCALE_IDS = ["de", "en"] as const;
export const WIDGET_KINDS = ["clock", "status", "tasks", "events", "cost", "chat", "notes", "quick", "t3", "memory"] as const;
export const COST_CHECK_IDS = ["an", "aus", "kaeufe"] as const;
export const WIDGET_SIZES = ["s", "m", "l"] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type DensityId = (typeof DENSITY_IDS)[number];
export type LocaleId = (typeof LOCALE_IDS)[number];
export type WidgetKind = (typeof WIDGET_KINDS)[number];
export type WidgetSize = (typeof WIDGET_SIZES)[number];
export type CostCheckId = (typeof COST_CHECK_IDS)[number];

export type WidgetItem = {
  id: string;
  kind: WidgetKind;
  size: WidgetSize;
};

export type AppSettings = {
  version: 1;
  locale: LocaleId;
  assistantLanguage: LocaleId;
  theme: ThemeId;
  accent: string | null;
  textScale: number;
  density: DensityId;
  radius: number;
  reduceMotion: boolean;
  haptics: boolean;
  t3Url: string;
  costCheck: CostCheckId;
  selfCheck: boolean;
  widgets: WidgetItem[];
};

export const DEFAULT_T3_URL = "http://127.0.0.1:3773";

export const DEFAULT_WIDGETS: WidgetItem[] = [
  { id: "clock", kind: "clock", size: "m" },
  { id: "status", kind: "status", size: "m" },
  { id: "tasks", kind: "tasks", size: "m" },
  { id: "events", kind: "events", size: "m" },
  { id: "quick", kind: "quick", size: "s" },
  { id: "notes", kind: "notes", size: "s" },
  { id: "cost", kind: "cost", size: "s" },
  { id: "chat", kind: "chat", size: "s" },
  { id: "t3", kind: "t3", size: "m" },
  { id: "memory", kind: "memory", size: "s" },
];

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  locale: "de",
  assistantLanguage: "de",
  theme: "midnight",
  accent: null,
  textScale: 1,
  density: "normal",
  radius: 1,
  reduceMotion: false,
  haptics: true,
  t3Url: "",
  costCheck: "an",
  selfCheck: true,
  widgets: DEFAULT_WIDGETS.map((item) => ({ ...item })),
};

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string, fallback: T): T {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new SettingsValidationError(`${label} ist ungültig`);
}

function bool(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  throw new SettingsValidationError(`${label} ist ungültig`);
}

function clampNumber(value: unknown, label: string, fallback: number, min: number, max: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SettingsValidationError(`${label} ist ungültig`);
  }
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100;
}

function accent(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new SettingsValidationError("Akzentfarbe ist ungültig");
  }
  return value.toLowerCase();
}

export function checkT3Url(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length > 300) {
    throw new SettingsValidationError("T3-Adresse ist zu lang");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SettingsValidationError("T3-Adresse ist ungültig");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SettingsValidationError("T3-Adresse muss http oder https sein");
  }
  if (url.username || url.password) {
    throw new SettingsValidationError("T3-Adresse darf keine Zugangsdaten enthalten");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function readDefaultT3Url(raw: string | undefined): string {
  try {
    return checkT3Url(raw?.trim() ?? "") || DEFAULT_T3_URL;
  } catch {
    return DEFAULT_T3_URL;
  }
}

function widgets(value: unknown, fallback: WidgetItem[]): WidgetItem[] {
  if (value === undefined) {
    return fallback.map((item) => ({ ...item }));
  }
  if (!Array.isArray(value) || value.length > 16) {
    throw new SettingsValidationError("Widget-Layout ist ungültig");
  }
  const seen = new Set<string>();
  return value.map((item) => {
    const record = asRecord(item);
    if (!record) {
      throw new SettingsValidationError("Widget-Layout ist ungültig");
    }
    const id = record.id;
    if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id) || seen.has(id)) {
      throw new SettingsValidationError("Widget-Id ist ungültig");
    }
    seen.add(id);
    const kind = oneOf(record.kind, WIDGET_KINDS, "Widget", "clock");
    if (record.kind === undefined) {
      throw new SettingsValidationError("Widget ist ungültig");
    }
    const size = oneOf(record.size, WIDGET_SIZES, "Widget-Größe", "m");
    if (record.size === undefined) {
      throw new SettingsValidationError("Widget-Größe ist ungültig");
    }
    return { id, kind, size };
  });
}

export function normalizeSettings(input: unknown, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const record = asRecord(input);
  if (!record) {
    throw new SettingsValidationError("Einstellungen müssen ein Objekt sein");
  }
  return {
    version: 1,
    locale: oneOf(record.locale, LOCALE_IDS, "Sprache", base.locale),
    assistantLanguage: oneOf(record.assistantLanguage, LOCALE_IDS, "Antwortsprache", base.assistantLanguage),
    theme: oneOf(record.theme, THEME_IDS, "Thema", base.theme),
    accent: record.accent === undefined ? base.accent : accent(record.accent),
    textScale: clampNumber(record.textScale, "Textgröße", base.textScale, 0.85, 1.3),
    density: oneOf(record.density, DENSITY_IDS, "Dichte", base.density),
    radius: clampNumber(record.radius, "Rundung", base.radius, 0.7, 1.4),
    reduceMotion: bool(record.reduceMotion, "Bewegung", base.reduceMotion),
    haptics: bool(record.haptics, "Haptik", base.haptics),
    t3Url: record.t3Url === undefined ? base.t3Url : checkT3Url(typeof record.t3Url === "string" ? record.t3Url : " "),
    costCheck: oneOf(record.costCheck, COST_CHECK_IDS, "Kosten-Check", base.costCheck),
    selfCheck: bool(record.selfCheck, "Selbst-Check", base.selfCheck),
    widgets: widgets(record.widgets, base.widgets),
  };
}
