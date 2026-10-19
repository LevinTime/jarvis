import { addCivilDays, berlinParts } from "@jarvis/dates.ts";

export function clock(iso: string): string {
  const parts = berlinParts(new Date(iso));
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function localInput(iso: string): string {
  const parts = berlinParts(new Date(iso));
  return `${parts.key}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function dayLabel(iso: string, now = new Date()): string {
  const key = berlinParts(new Date(iso)).key;
  const today = berlinParts(now).key;
  if (key === today) {
    return "Heute";
  }
  if (key === addCivilDays(today, -1)) {
    return "Gestern";
  }
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

export function longDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12));
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function usd(value: number): string {
  const tiny = value > 0 && value < 0.01;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: tiny ? 4 : 2,
    maximumFractionDigits: tiny ? 4 : 2,
  }).format(value);
}

export function tokens(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

export function repeatLabel(value: string | null | undefined): string {
  if (value === "taeglich") {
    return "täglich";
  }
  if (value === "woechentlich") {
    return "wöchentlich";
  }
  return "einmal";
}

const SOURCES: Record<string, string> = {
  telegram: "Telegram",
  web: "Web",
  cli: "CLI",
  cron: "Erinnerung",
  system: "System",
};

const PURPOSES: Record<string, string> = {
  chat: "Chat",
  tool: "Werkzeug",
  translate: "Übersetzung",
  summary: "Zusammenfassung",
};

export function sourceLabel(value: string): string {
  return SOURCES[value] ?? value;
}

export function purposeLabel(value: string): string {
  return PURPOSES[value] ?? value;
}
