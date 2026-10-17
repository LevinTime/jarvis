import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Note = {
  id: string;
  person?: string;
  text: string;
  erstelltAm: string;
  offen: boolean;
  erinnernAm?: string;
};

export type NoteInput = {
  id?: string;
  person?: string;
  text: string;
  erinnernAm?: string;
};

export class NoteNotFoundError extends Error {
  readonly noteId: string;

  constructor(noteId: string) {
    super(`Notiz nicht gefunden: ${noteId}`);
    this.name = "NoteNotFoundError";
    this.noteId = noteId;
  }
}

export class NoteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteValidationError";
  }
}

type NoteServiceOptions = {
  dataDir: string;
  now?: () => Date;
};

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function optionalPerson(value: string | undefined): string | undefined {
  const text = value?.trim() ?? "";
  return text || undefined;
}

function optionalErinnernAm(value: string | undefined): string | undefined {
  const text = value?.trim() ?? "";
  if (!text) {
    return undefined;
  }
  if (!Number.isFinite(Date.parse(text))) {
    throw new NoteValidationError("erinnernAm muss ein ISO-Datum sein");
  }
  return text;
}

export function createNoteService(options: NoteServiceOptions) {
  const notesFile = path.join(options.dataDir, "notes.json");
  const nowIso = () => (options.now ?? (() => new Date()))().toISOString();

  async function ensureDir() {
    await mkdir(options.dataDir, { recursive: true });
  }

  async function load(): Promise<Note[]> {
    try {
      const raw = await readFile(notesFile, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new Error("notes.json ist kein Array");
      }
      return parsed as Note[];
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  async function save(notes: Note[]) {
    await ensureDir();
    await writeFile(notesFile, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
  }

  async function add(input: NoteInput): Promise<Note> {
    const text = input.text?.trim() ?? "";
    if (!text) {
      throw new NoteValidationError("text darf nicht leer sein");
    }
    const person = optionalPerson(input.person);
    const erinnernAm = optionalErinnernAm(input.erinnernAm);
    const notes = await load();
    const id = input.id?.trim() || randomUUID();
    if (notes.some((note) => note.id === id)) {
      throw new NoteValidationError(`Notiz-ID existiert schon: ${id}`);
    }

    const note: Note = {
      id,
      text,
      erstelltAm: nowIso(),
      offen: true,
      ...(person ? { person } : {}),
      ...(erinnernAm ? { erinnernAm } : {}),
    };
    notes.push(note);
    await save(notes);
    return note;
  }

  async function list(): Promise<Note[]> {
    return load();
  }

  async function listOpen(): Promise<Note[]> {
    return (await load()).filter((note) => note.offen);
  }

  async function get(id: string): Promise<Note> {
    const note = (await load()).find((item) => item.id === id);
    if (!note) {
      throw new NoteNotFoundError(id);
    }
    return note;
  }

  async function close(id: string): Promise<Note> {
    const notes = await load();
    const index = notes.findIndex((note) => note.id === id);
    if (index === -1) {
      throw new NoteNotFoundError(id);
    }
    const current = notes[index];
    if (!current) {
      throw new NoteNotFoundError(id);
    }
    if (!current.offen) {
      return current;
    }
    const closed: Note = { ...current, offen: false };
    notes[index] = closed;
    await save(notes);
    return closed;
  }

  return { add, list, listOpen, get, close };
}

export type NoteService = ReturnType<typeof createNoteService>;
