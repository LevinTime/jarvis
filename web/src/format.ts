import { addCivilDays, berlinParts } from "@jarvis/dates.ts";
import { getLocale, t } from "./i18n/index.ts";

function localeTag(): string {
  return getLocale() === "en" ? "en-GB" : "de-DE";
}

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
    return t("time.today");
  }
  if (key === addCivilDays(today, -1)) {
    return t("time.yesterday");
  }
  return new Intl.DateTimeFormat(localeTag(), {
    timeZone: "Europe/Berlin",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

export function longDay(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1, 12));
  return new Intl.DateTimeFormat(localeTag(), {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function usd(value: number): string {
  const tiny = value > 0 && value < 0.01;
  return new Intl.NumberFormat(localeTag(), {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: tiny ? 4 : 2,
    maximumFractionDigits: tiny ? 4 : 2,
  }).format(value);
}

export function tokens(value: number): string {
  return new Intl.NumberFormat(localeTag()).format(value);
}

export function repeatLabel(value: string | null | undefined): string {
  if (value === "taeglich") {
    return t("common.daily");
  }
  if (value === "woechentlich") {
    return t("common.weekly");
  }
  return t("common.once");
}

export function sourceLabel(value: string): string {
  if (value === "telegram") return t("source.telegram");
  if (value === "web") return t("source.web");
  if (value === "cli") return t("source.cli");
  if (value === "cron") return t("source.cron");
  if (value === "system") return t("source.system");
  return value;
}

export function purposeLabel(value: string): string {
  if (value === "chat") return t("purpose.chat");
  if (value === "tool") return t("purpose.tool");
  if (value === "translate") return t("purpose.translate");
  if (value === "summary") return t("purpose.summary");
  return value;
}
