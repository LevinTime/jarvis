export const MEMORY_CATEGORIES = [
  "person",
  "vorliebe",
  "ort",
  "projekt",
  "termin-kontext",
  "regel",
  "korrektur",
] as const;

export const MEMORY_SOURCES = ["telegram", "web", "manuell"] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type MemorySource = (typeof MEMORY_SOURCES)[number];
export type MemoryImportance = 1 | 2 | 3;

export type MemoryRevision = {
  text: string;
  ersetztAm: string;
};

export type MemoryFact = {
  id: string;
  text: string;
  kategorie: MemoryCategory;
  quelle: MemorySource;
  erstelltAm: string;
  zuletztBestätigt: string;
  wichtigkeit: MemoryImportance;
  aktiv: boolean;
  verlauf?: MemoryRevision[];
};

export class MemoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryValidationError";
  }
}

export class MemoryNotFoundError extends Error {
  constructor(id: string) {
    super(`Eintrag nicht gefunden: ${id}`);
    this.name = "MemoryNotFoundError";
  }
}

const STOPWORDS = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "und", "oder",
  "aber", "mit", "von", "vom", "zu", "zum", "zur", "im", "in", "an", "auf", "ist",
  "sind", "war", "hat", "habe", "ich", "du", "er", "sie", "es", "wir", "ihr",
  "nicht", "auch", "noch", "schon", "fuer", "dass", "wenn", "wie", "was", "wer",
  "mal", "nur", "bei", "aus", "nach", "vor", "über", "ueber",
]);

const NAME_SKIP = new Set([
  "ich", "du", "jarvis", "der", "die", "das", "ein", "eine", "und", "aber", "wenn",
  "heute", "morgen", "berlin", "montag", "dienstag", "mittwoch", "donnerstag",
  "freitag", "samstag", "sonntag",
]);

const SECRET_PATTERNS = [
  /xai-[A-Za-z0-9_-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{12,}/i,
  /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/,
  /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/,
  /\b(?:bearer|api[-_ ]?key|token|passwort|password|pin|iban|kontonummer)\b\s*[:=]\s*\S{6,}/i,
  /\b(?:bearer|api[-_ ]?key|token|passwort|password|pin|iban|kontonummer)\b\s+ist\s+(?=\S{6,})(?=\S*\d)\S+/i,
];

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function normalizeFactText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function factTokens(text: string): string[] {
  return normalizeFactText(text)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

export function secretReason(text: string): string | null {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    return "Passwörter, Tokens und Kontodaten werden nicht gespeichert";
  }
  return null;
}

export function assertNoSecret(text: string): void {
  const reason = secretReason(text);
  if (reason) {
    throw new MemoryValidationError(reason);
  }
}

function overlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const other = new Set(right);
  let shared = 0;
  for (const token of new Set(left)) {
    if (other.has(token)) {
      shared += 1;
    }
  }
  return shared / Math.min(new Set(left).size, new Set(right).size);
}

function sharedCount(left: string[], right: string[]): number {
  const other = new Set(right);
  let shared = 0;
  for (const token of new Set(left)) {
    if (other.has(token)) {
      shared += 1;
    }
  }
  return shared;
}

export function findSimilar(
  facts: MemoryFact[],
  text: string,
): { kind: "same" | "conflict"; fact: MemoryFact } | null {
  const normalized = normalizeFactText(text);
  const tokens = factTokens(text);
  let conflict: MemoryFact | null = null;
  for (const fact of facts) {
    if (!fact.aktiv) {
      continue;
    }
    const other = normalizeFactText(fact.text);
    if (other === normalized) {
      return { kind: "same", fact };
    }
    const shorter = normalized.length <= other.length ? normalized : other;
    const longer = normalized.length <= other.length ? other : normalized;
    const contained = shorter.length >= 12 && longer.includes(shorter);
    const left = factTokens(fact.text);
    const sameStart = tokens[0] !== undefined && tokens[0] === left[0];
    const close = sameStart && sharedCount(tokens, left) >= 2 && overlap(tokens, left) >= 0.6;
    if ((contained || close) && !conflict) {
      conflict = fact;
    }
  }
  return conflict ? { kind: "conflict", fact: conflict } : null;
}

export function memoryLine(fact: MemoryFact): string {
  return `- [${fact.kategorie}] ${fact.text}`;
}

export function selectMemory(facts: MemoryFact[], query: string, maxTokens = 800): MemoryFact[] {
  const keys = factTokens(query);
  const ranked = facts
    .filter((fact) => fact.aktiv)
    .map((fact) => {
      const hay = normalizeFactText(fact.text);
      const hits = keys.filter((key) => hay.includes(key)).length;
      return { fact, hits };
    })
    .filter((item) => item.fact.wichtigkeit === 3 || item.hits > 0);
  ranked.sort((a, b) => {
    if (b.fact.wichtigkeit !== a.fact.wichtigkeit) {
      return b.fact.wichtigkeit - a.fact.wichtigkeit;
    }
    if (b.hits !== a.hits) {
      return b.hits - a.hits;
    }
    return b.fact.zuletztBestätigt.localeCompare(a.fact.zuletztBestätigt);
  });
  const picked: MemoryFact[] = [];
  let tokens = 0;
  for (const item of ranked) {
    const cost = estimateTokens(memoryLine(item.fact));
    if (tokens + cost > maxTokens) {
      continue;
    }
    picked.push(item.fact);
    tokens += cost;
  }
  return picked;
}

export function renderMemoryContext(
  facts: MemoryFact[],
  costCheck: "an" | "aus" | "kaeufe",
): string {
  const lines: string[] = [];
  if (facts.length > 0) {
    lines.push("Bekannte Fakten. Nur diese verwenden, nichts dazuerfinden:");
    for (const fact of facts) {
      lines.push(memoryLine(fact));
    }
  }
  if (costCheck === "aus") {
    lines.push("Kosten-Check: aus. Hänge keinen Kosten-Block an.");
  } else if (costCheck === "kaeufe") {
    lines.push("Kosten-Check: nur bei Käufen, Abos und Bestellungen.");
  }
  return lines.join("\n");
}

export function renderMemoryMarkdown(facts: MemoryFact[]): string {
  const lines = ["# Gedächtnis", ""];
  for (const category of MEMORY_CATEGORIES) {
    const rows = facts.filter((fact) => fact.aktiv && fact.kategorie === category);
    if (rows.length === 0) {
      continue;
    }
    lines.push(`## ${category}`, "");
    for (const fact of rows) {
      lines.push(`- ${fact.text} (Wichtigkeit ${fact.wichtigkeit})`);
    }
    lines.push("");
  }
  const inactive = facts.filter((fact) => !fact.aktiv);
  if (inactive.length > 0) {
    lines.push("## Inaktiv", "");
    for (const fact of inactive) {
      lines.push(`- ${fact.text}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
}

export function needsSelfCheck(text: string): boolean {
  if (/\d/.test(text)) {
    return true;
  }
  if (/[€$]|\b(?:euro|usd|preis|kosten)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|heute|morgen)\b/i.test(text)) {
    return true;
  }
  const words = text.split(/\s+/);
  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1] ?? "";
    if (/[.!?]$/.test(previous)) {
      continue;
    }
    const raw = (words[index] ?? "").replace(/[^\p{L}]/gu, "");
    if (raw.length < 3 || !/^\p{Lu}/u.test(raw)) {
      continue;
    }
    if (NAME_SKIP.has(raw.toLowerCase())) {
      continue;
    }
    return true;
  }
  return false;
}

export function applySelfCheck(original: string, verdict: string): string {
  const next = verdict.trim();
  if (!next || /^ok\b/i.test(next)) {
    return original;
  }
  return next;
}

export function parseFalschReply(text: string): string | null {
  const match = /^\s*falsch:\s*([\s\S]*)$/i.exec(text);
  if (!match) {
    return null;
  }
  const body = match[1]?.trim() ?? "";
  return body || "als falsch markiert";
}

export function isCategory(value: unknown): value is MemoryCategory {
  return typeof value === "string" && (MEMORY_CATEGORIES as readonly string[]).includes(value);
}

export function isSource(value: unknown): value is MemorySource {
  return typeof value === "string" && (MEMORY_SOURCES as readonly string[]).includes(value);
}

export function isImportance(value: unknown): value is MemoryImportance {
  return value === 1 || value === 2 || value === 3;
}
