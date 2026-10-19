export const BERLIN = "Europe/Berlin";

export type BerlinParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  key: string;
};

export function berlinParts(date: Date): BerlinParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BERLIN,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const bag: Record<string, string> = {};
  for (const part of parts) {
    bag[part.type] = part.value;
  }
  const year = Number(bag.year);
  const month = Number(bag.month);
  const day = Number(bag.day);
  return {
    year,
    month,
    day,
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    key: `${bag.year}-${bag.month}-${bag.day}`,
  };
}

export function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export type GridDay = { key: string; inMonth: boolean };

/** Civil month grid, Monday first. `month` is 1–12. */
export function monthGrid(year: number, month: number): GridDay[] {
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: GridDay[] = [];
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevDays = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  for (let index = 0; index < lead; index += 1) {
    const day = prevDays - lead + 1 + index;
    cells.push({ key: `${prevYear}-${pad(prevMonth)}-${pad(day)}`, inMonth: false });
  }
  for (let day = 1; day <= days; day += 1) {
    cells.push({ key: `${year}-${pad(month)}-${pad(day)}`, inMonth: true });
  }
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  let next = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ key: `${nextYear}-${pad(nextMonth)}-${pad(next)}`, inMonth: false });
    next += 1;
  }
  return cells;
}

export function mondayOf(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addCivilDays(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function greeting(date: Date): string {
  const hour = berlinParts(date).hour;
  if (hour < 5 || hour >= 22) {
    return "Gute Nacht";
  }
  if (hour < 11) {
    return "Guten Morgen";
  }
  if (hour < 18) {
    return "Guten Tag";
  }
  return "Guten Abend";
}

export type TaskBucket = "overdue" | "today" | "soon" | "undated" | "done";

/** Matches the server: overdue is before today's Berlin date, not earlier the same day. */
export function bucketTask(
  task: { status: string; faelligAm?: string | null },
  todayKey: string,
): TaskBucket {
  if (task.status === "erledigt") {
    return "done";
  }
  if (!task.faelligAm) {
    return "undated";
  }
  const due = Date.parse(task.faelligAm);
  if (!Number.isFinite(due)) {
    return "undated";
  }
  const key = berlinParts(new Date(due)).key;
  if (key < todayKey) {
    return "overdue";
  }
  if (key === todayKey) {
    return "today";
  }
  return "soon";
}
