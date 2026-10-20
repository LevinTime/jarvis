export const LAYOUT_VERSION = 1;
export const LAYOUT_STORAGE_KEY = "jarvis.dashboard.layout.v1";

export type BreakpointId = "lg" | "md" | "sm";
export type TileSize = "s" | "m" | "l";

export type TileLayout = {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DashboardLayouts = Record<BreakpointId, TileLayout[]>;

export const BREAKPOINTS: Record<BreakpointId, number> = { lg: 1024, md: 640, sm: 0 };
export const COLS: Record<BreakpointId, number> = { lg: 12, md: 8, sm: 4 };
export const BREAKPOINT_IDS: readonly BreakpointId[] = ["lg", "md", "sm"];

const DEFAULT_SIZE: Record<string, TileSize> = {
  status: "m",
  tasks: "l",
  events: "l",
  quick: "m",
  notes: "s",
  chat: "s",
  t3: "m",
  memory: "s",
};

function colsFor(breakpoint: BreakpointId): number {
  return COLS[breakpoint];
}

export function defaultTileSize(id: string): TileSize {
  return DEFAULT_SIZE[id] ?? "m";
}

/** S is one unit, M and L are two units wide. L is one row taller than the content height. */
export function spanFor(id: string, size: TileSize, cols: number): { w: number; h: number } {
  if (id === "status") {
    return { w: cols, h: 1 };
  }
  const unit = cols >= 12 ? 3 : 2;
  const w = size === "s" ? unit : Math.min(cols, unit * 2);
  const content =
    id === "tasks" ? 4 : id === "events" ? 3 : id === "quick" || id === "notes" || id === "chat" || id === "t3" || id === "memory" ? 2 : 1;
  const h = size === "l" ? content + 1 : content;
  return { w, h };
}

export function nearestSize(w: number, h: number, id: string, cols: number): TileSize {
  const choices: TileSize[] = ["s", "m", "l"];
  let best: TileSize = "m";
  let score = Number.POSITIVE_INFINITY;
  for (const size of choices) {
    const span = spanFor(id, size, cols);
    const next = Math.abs(span.w - w) + Math.abs(span.h - h);
    if (next < score) {
      score = next;
      best = size;
    }
  }
  return best;
}

function pack(ids: readonly string[], cols: number): TileLayout[] {
  const tiles: TileLayout[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const id of ids) {
    const span = spanFor(id, defaultTileSize(id), cols);
    if (x > 0 && x + span.w > cols) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    tiles.push({ i: id, x, y, w: span.w, h: span.h });
    x += span.w;
    rowH = Math.max(rowH, span.h);
    if (x >= cols) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
  }
  return tiles;
}

export function packLayouts(ids: readonly string[]): DashboardLayouts {
  return {
    lg: pack(ids, colsFor("lg")),
    md: pack(ids, colsFor("md")),
    sm: pack(ids, colsFor("sm")),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseTiles(value: unknown): TileLayout[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const seen = new Set<string>();
  const tiles: TileLayout[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.i !== "string" || !/^[a-z0-9-]{1,40}$/.test(item.i) || seen.has(item.i)) {
      return null;
    }
    const nums = [item.x, item.y, item.w, item.h];
    if (nums.some((num) => typeof num !== "number" || !Number.isFinite(num) || num < 0)) {
      return null;
    }
    if ((item.w as number) < 1 || (item.h as number) < 1) {
      return null;
    }
    seen.add(item.i);
    tiles.push({
      i: item.i,
      x: item.x as number,
      y: item.y as number,
      w: item.w as number,
      h: item.h as number,
    });
  }
  return tiles;
}

export function mergeLayouts(stored: DashboardLayouts, ids: readonly string[]): DashboardLayouts {
  const next = {} as DashboardLayouts;
  for (const breakpoint of BREAKPOINT_IDS) {
    const cols = colsFor(breakpoint);
    const kept = stored[breakpoint].filter((tile) => ids.includes(tile.i));
    const have = new Set(kept.map((tile) => tile.i));
    let y = kept.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0);
    let x = 0;
    let rowH = 0;
    const added: TileLayout[] = [];
    for (const id of ids) {
      if (have.has(id)) {
        continue;
      }
      const span = spanFor(id, defaultTileSize(id), cols);
      if (x > 0 && x + span.w > cols) {
        y += rowH;
        x = 0;
        rowH = 0;
      }
      added.push({ i: id, x, y, w: span.w, h: span.h });
      x += span.w;
      rowH = Math.max(rowH, span.h);
    }
    next[breakpoint] = [...kept, ...added];
  }
  return next;
}

export function layoutsEqual(left: DashboardLayouts, right: DashboardLayouts): boolean {
  return BREAKPOINT_IDS.every((breakpoint) => {
    const a = left[breakpoint];
    const b = right[breakpoint];
    if (a.length !== b.length) {
      return false;
    }
    return a.every((tile) => {
      const other = b.find((item) => item.i === tile.i);
      return Boolean(other && other.x === tile.x && other.y === tile.y && other.w === tile.w && other.h === tile.h);
    });
  });
}

/** Returns the default grid when the saved value is missing, broken, or from an older version. */
export function readDashboardLayouts(raw: string | null, ids: readonly string[]): DashboardLayouts {
  const fallback = packLayouts(ids);
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || parsed.version !== LAYOUT_VERSION || !isRecord(parsed.layouts)) {
      return fallback;
    }
    const stored = {} as DashboardLayouts;
    for (const breakpoint of BREAKPOINT_IDS) {
      const tiles = parseTiles(parsed.layouts[breakpoint]);
      if (!tiles) {
        return fallback;
      }
      stored[breakpoint] = tiles;
    }
    return mergeLayouts(stored, ids);
  } catch {
    return fallback;
  }
}

export function serializeDashboardLayouts(layouts: DashboardLayouts): string {
  return JSON.stringify({ version: LAYOUT_VERSION, layouts });
}
