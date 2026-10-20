import { berlinParts } from "./dates.ts";

export const DAY_START_MIN = 7 * 60;
export const DAY_END_MIN = 22 * 60;
export const DEFAULT_BLOCK_MIN = 45;

export type DayEvent = {
  id: string;
  title: string;
  startMin: number;
  endMin?: number;
};

export type DayBlock = {
  id: string;
  title: string;
  startMin: number;
  endMin: number;
  left: number;
  width: number;
};

export type DayNext = {
  id: string;
  title: string;
  startMin: number;
};

export type DayBar = {
  hours: number[];
  blocks: DayBlock[];
  nowLeft: number | null;
  next: DayNext | null;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function minutesInBerlin(date: Date): number {
  const parts = berlinParts(date);
  return parts.hour * 60 + parts.minute;
}

export function layoutDayBar(input: {
  events: readonly DayEvent[];
  nowMin: number;
  startMin?: number;
  endMin?: number;
  blockMin?: number;
}): DayBar {
  const start = input.startMin ?? DAY_START_MIN;
  const end = input.endMin ?? DAY_END_MIN;
  const span = Math.max(1, end - start);
  const blockMin = input.blockMin ?? DEFAULT_BLOCK_MIN;
  const hours: number[] = [];
  for (let hour = Math.ceil(start / 60); hour <= Math.floor(end / 60); hour += 1) {
    hours.push(hour);
  }
  const sorted = input.events
    .filter((event) => Number.isFinite(event.startMin))
    .slice()
    .sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
  const blocks: DayBlock[] = [];
  for (const event of sorted) {
    const eventEnd = event.endMin ?? event.startMin + blockMin;
    const visStart = Math.max(event.startMin, start);
    const visEnd = Math.min(Math.max(eventEnd, event.startMin), end);
    if (visEnd <= visStart) {
      continue;
    }
    const left = ((visStart - start) / span) * 100;
    const width = Math.min(100 - left, Math.max(2, ((visEnd - visStart) / span) * 100));
    blocks.push({
      id: event.id,
      title: event.title,
      startMin: event.startMin,
      endMin: eventEnd,
      left: round(left),
      width: round(width),
    });
  }
  const nowLeft = input.nowMin >= start && input.nowMin < end ? round(((input.nowMin - start) / span) * 100) : null;
  const upcoming = sorted.find((event) => event.startMin >= input.nowMin);
  return {
    hours,
    blocks,
    nowLeft,
    next: upcoming ? { id: upcoming.id, title: upcoming.title, startMin: upcoming.startMin } : null,
  };
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Static markup of the day bar. The React tile uses the same class names. */
export function renderDayBar(bar: DayBar): string {
  const hours = bar.hours.map((hour) => `<span>${String(hour).padStart(2, "0")}</span>`).join("");
  const blocks = bar.blocks
    .map(
      (block) =>
        `<span class="day-block" style="left:${block.left}%;width:${block.width}%">${escapeText(block.title)}</span>`,
    )
    .join("");
  const now = bar.nowLeft === null ? "" : `<span class="day-now" style="left:${bar.nowLeft}%"></span>`;
  const next = bar.next ? escapeText(bar.next.title) : "";
  return `<div class="day-bar"><div class="day-hours">${hours}</div><div class="day-track">${blocks}${now}</div></div><p class="day-next">${next}</p>`;
}
