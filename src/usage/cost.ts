import { addDays, dayKey, startOfDay } from "../tasks/schedule.ts";
import { priceFor } from "./prices.ts";
import type { UsageEntry, UsagePurpose, UsageSource } from "./types.ts";

export type UsageTotals = {
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  requests: number;
  errors: number;
};

export type UsageDay = UsageTotals & { date: string };

export type BudgetLevel = "none" | "ok" | "warn" | "over";

export type UsageReport = {
  range: UsageRange;
  headline: UsageTotals;
  today: UsageTotals;
  last7d: UsageTotals;
  month: UsageTotals;
  last30d: UsageTotals;
  byDay: UsageDay[];
  bySource: Partial<Record<UsageSource, UsageTotals>>;
  byPurpose: Partial<Record<UsagePurpose, UsageTotals>>;
  budget: {
    limitUsd: number | null;
    spentUsd: number;
    ratio: number | null;
    level: BudgetLevel;
  };
  pricesAreEstimates: true;
};

export type UsageRange = "today" | "7d" | "month" | "30d";

const EMPTY: UsageTotals = {
  costUsd: 0,
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
  requests: 0,
  errors: 0,
};

export function costUsd(
  entry: Pick<UsageEntry, "model" | "promptTokens" | "completionTokens" | "cachedTokens" | "ok">,
): number {
  if (!entry.ok) {
    return 0;
  }
  const price = priceFor(entry.model);
  if (!price) {
    return 0;
  }
  const prompt = Math.max(0, entry.promptTokens);
  const cached = Math.min(Math.max(0, entry.cachedTokens ?? 0), prompt);
  const fresh = prompt - cached;
  return (
    (fresh / 1_000_000) * price.input +
    (cached / 1_000_000) * price.cachedInput +
    (entry.completionTokens / 1_000_000) * price.output
  );
}

export function budgetNotice(level: BudgetLevel, spentUsd: number, limitUsd: number): string {
  const spent = spentUsd.toFixed(2);
  const limit = limitUsd.toFixed(2);
  if (level === "over") {
    return `Monatsbudget aufgebraucht (${spent} von ${limit} USD). Jarvis antwortet weiter, die Kosten laufen darüber hinaus.`;
  }
  if (level === "warn") {
    return `80 % des Monatsbudgets sind erreicht (${spent} von ${limit} USD). Jarvis antwortet weiter.`;
  }
  return "";
}

export function budgetLevel(spentUsd: number, limitUsd: number | null): BudgetLevel {
  if (limitUsd === null || !(limitUsd > 0)) {
    return "none";
  }
  const ratio = spentUsd / limitUsd;
  if (ratio >= 1) {
    return "over";
  }
  if (ratio >= 0.8) {
    return "warn";
  }
  return "ok";
}

function add(target: UsageTotals, entry: UsageEntry): void {
  target.requests += 1;
  if (!entry.ok) {
    target.errors += 1;
    return;
  }
  target.promptTokens += entry.promptTokens;
  target.completionTokens += entry.completionTokens;
  target.cachedTokens += entry.cachedTokens ?? 0;
  target.costUsd += costUsd(entry);
}

function clone(): UsageTotals {
  return { ...EMPTY };
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function aggregateUsage(options: {
  entries: UsageEntry[];
  now?: Date;
  timeZone?: string;
  budgetUsd?: number | null;
  range?: UsageRange;
}): UsageReport {
  const timeZone = options.timeZone ?? "Europe/Berlin";
  const now = options.now ?? new Date();
  const range = options.range ?? "month";
  const todayKey = dayKey(now, timeZone);
  const monthKey = todayKey.slice(0, 7);
  const startToday = startOfDay(now, timeZone);
  const start7 = dayKey(addDays(startToday, -6, timeZone), timeZone);
  const start30 = dayKey(addDays(startToday, -29, timeZone), timeZone);

  const today = clone();
  const last7d = clone();
  const month = clone();
  const last30d = clone();
  const byDayMap = new Map<string, UsageTotals>();
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = dayKey(addDays(startToday, -offset, timeZone), timeZone);
    byDayMap.set(date, clone());
  }

  const rangeStart =
    range === "today" ? todayKey : range === "7d" ? start7 : range === "30d" ? start30 : `${monthKey}-01`;
  const rangeEnd = todayKey;
  const bySource: UsageReport["bySource"] = {};
  const byPurpose: UsageReport["byPurpose"] = {};

  for (const entry of options.entries) {
    const parsed = Date.parse(entry.ts);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const date = dayKey(new Date(parsed), timeZone);
    if (date === todayKey) {
      add(today, entry);
    }
    if (inRange(date, start7, todayKey)) {
      add(last7d, entry);
    }
    if (date.slice(0, 7) === monthKey) {
      add(month, entry);
    }
    if (inRange(date, start30, todayKey)) {
      add(last30d, entry);
    }
    const bucket = byDayMap.get(date);
    if (bucket) {
      add(bucket, entry);
    }
    if (inRange(date, rangeStart, rangeEnd)) {
      const source = (bySource[entry.source] ??= clone());
      add(source, entry);
      const purpose = (byPurpose[entry.purpose] ??= clone());
      add(purpose, entry);
    }
  }

  const headline =
    range === "today" ? today : range === "7d" ? last7d : range === "30d" ? last30d : month;
  const limitUsd = options.budgetUsd ?? null;
  const ratio = limitUsd && limitUsd > 0 ? month.costUsd / limitUsd : null;

  return {
    range,
    headline,
    today,
    last7d,
    month,
    last30d,
    byDay: [...byDayMap.entries()].map(([date, totals]) => ({ date, ...totals })),
    bySource,
    byPurpose,
    budget: {
      limitUsd,
      spentUsd: month.costUsd,
      ratio,
      level: budgetLevel(month.costUsd, limitUsd),
    },
    pricesAreEstimates: true,
  };
}
