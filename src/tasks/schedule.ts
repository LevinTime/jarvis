export type Wiederholung = "taeglich" | "woechentlich";

type Civil = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function civilInZone(date: Date, timeZone: string): Civil {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const hour = read("hour");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: hour === 24 ? 0 : hour,
    minute: read("minute"),
    second: read("second"),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const civil = civilInZone(date, timeZone);
  const asUtc = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  );
  return asUtc - date.getTime();
}

function zonedTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const first = new Date(guess.getTime() - offsetMs(guess, timeZone));
  return new Date(guess.getTime() - offsetMs(first, timeZone));
}

function formatIso(date: Date, timeZone: string): string {
  const civil = civilInZone(date, timeZone);
  const offsetMin = Math.round(offsetMs(date, timeZone) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${civil.year}-${pad(civil.month)}-${pad(civil.day)}T${pad(civil.hour)}:${pad(civil.minute)}:${pad(civil.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function dayKey(date: Date, timeZone = "Europe/Berlin"): string {
  const civil = civilInZone(date, timeZone);
  return `${civil.year}-${pad(civil.month)}-${pad(civil.day)}`;
}

export function startOfDay(date: Date, timeZone = "Europe/Berlin"): Date {
  const civil = civilInZone(date, timeZone);
  return zonedTime(civil.year, civil.month, civil.day, 0, 0, 0, timeZone);
}

export function addDays(date: Date, days: number, timeZone = "Europe/Berlin"): Date {
  const civil = civilInZone(date, timeZone);
  const shifted = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + days));
  return zonedTime(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    civil.hour,
    civil.minute,
    civil.second,
    timeZone,
  );
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

export function startOfWeek(date: Date, timeZone = "Europe/Berlin"): Date {
  const civil = civilInZone(date, timeZone);
  const noon = zonedTime(civil.year, civil.month, civil.day, 12, 0, 0, timeZone);
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
  }).format(noon);
  const index = WEEKDAY_INDEX[weekday] ?? 0;
  return addDays(startOfDay(date, timeZone), -index, timeZone);
}

export function isoInZone(local: string, timeZone = "Europe/Berlin"): string {
  const trimmed = local.trim();
  if (!trimmed) {
    throw new Error("faelligAm muss ein ISO-Datum sein");
  }
  if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isFinite(parsed.getTime())) {
      throw new Error("faelligAm muss ein ISO-Datum sein");
    }
    return formatIso(parsed, timeZone);
  }
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(trimmed);
  if (!match) {
    throw new Error("faelligAm muss ein ISO-Datum sein");
  }
  const instant = zonedTime(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4] ?? "0"),
    Number(match[5] ?? "0"),
    Number(match[6] ?? "0"),
    timeZone,
  );
  return formatIso(instant, timeZone);
}

export function nextOccurrence(
  iso: string,
  wiederholung: Wiederholung,
  timeZone = "Europe/Berlin",
): string {
  const base = new Date(iso);
  if (!Number.isFinite(base.getTime())) {
    throw new Error("faelligAm muss ein ISO-Datum sein");
  }
  const civil = civilInZone(base, timeZone);
  const days = wiederholung === "taeglich" ? 1 : 7;
  const shifted = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + days));
  const next = zonedTime(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    civil.hour,
    civil.minute,
    civil.second,
    timeZone,
  );
  return formatIso(next, timeZone);
}
