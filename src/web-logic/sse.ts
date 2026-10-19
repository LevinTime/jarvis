export type SseBlock = {
  event: string;
  data: string;
  id?: number;
};

/** One SSE frame, separated by a blank line. Heartbeats (`: ping`) are ignored. */
export function parseSseBlock(block: string): SseBlock | null {
  let event = "message";
  const data: string[] = [];
  let id: number | undefined;
  let saw = false;
  for (const raw of block.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line || line.startsWith(":")) {
      continue;
    }
    const split = line.indexOf(":");
    if (split < 0) {
      continue;
    }
    saw = true;
    const field = line.slice(0, split);
    const value = line.slice(split + 1).replace(/^ /, "");
    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    } else if (field === "id") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        id = parsed;
      }
    }
  }
  if (!saw) {
    return null;
  }
  return { event, data: data.join("\n"), ...(id !== undefined ? { id } : {}) };
}
