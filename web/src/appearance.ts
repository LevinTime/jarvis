import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
  type ThemeId,
} from "../../src/settings/model.ts";
import { setHaptics } from "./feel.ts";
import { setLocale } from "./i18n/index.ts";

const STORAGE_KEY = "jarvis-settings";

const THEME_COLOR: Record<ThemeId, string> = {
  midnight: "#07070f",
  ocean: "#06141c",
  aurora: "#07110e",
  graphite: "#101114",
  light: "#f3f5fb",
};

function copyDefaults(): AppSettings {
  return normalizeSettings({}, DEFAULT_SETTINGS);
}

export function readLocalSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return normalizeSettings(JSON.parse(raw) as unknown, DEFAULT_SETTINGS);
    }
    const legacy = localStorage.getItem("jarvis-theme");
    if (legacy === "light") {
      return { ...copyDefaults(), theme: "light" };
    }
  } catch {
    /* private mode or an old value */
  }
  return copyDefaults();
}

export function writeLocalSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function applyAppearance(settings: AppSettings): void {
  const root = document.documentElement;
  const reduce =
    settings.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
  root.dataset.motion = reduce ? "reduce" : "full";
  root.lang = settings.locale;
  root.style.removeProperty("--text-scale");
  root.style.setProperty("--radius-scale", String(settings.radius));
  if (settings.accent) {
    root.dataset.accent = "custom";
    root.style.setProperty("--accent", settings.accent);
  } else {
    delete root.dataset.accent;
    root.style.removeProperty("--accent");
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[settings.theme]);
  setLocale(settings.locale);
  setHaptics(settings.haptics);
}
