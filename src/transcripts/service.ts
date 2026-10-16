import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type TranscriptLine = {
  uhrzeit: string;
  sprecher: string;
  text: string;
};

export type Transcript = {
  id: string;
  title: string;
  entries: TranscriptLine[];
};

export class TranscriptNotFoundError extends Error {
  readonly transcriptId: string;

  constructor(transcriptId: string) {
    super(`Transkript nicht gefunden: ${transcriptId}`);
    this.name = "TranscriptNotFoundError";
    this.transcriptId = transcriptId;
  }
}

type TranscriptServiceOptions = {
  transcriptsDir: string;
};

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function idFromFile(name: string): string {
  return name.replace(/\.md$/i, "");
}

const TABLE_ROW =
  /^\|\s*(\d{1,2}:\d{2})\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$/;

function parseMarkdown(id: string, raw: string): Transcript {
  const lines = raw.split(/\r?\n/);
  const heading = lines.find((line) => line.startsWith("# "));
  const title = heading ? heading.slice(2).trim() : id;
  const entries: TranscriptLine[] = [];

  for (const line of lines) {
    const match = TABLE_ROW.exec(line);
    if (!match) {
      continue;
    }
    entries.push({
      uhrzeit: match[1] ?? "",
      sprecher: (match[2] ?? "").trim(),
      text: (match[3] ?? "").trim(),
    });
  }

  return { id, title, entries };
}

export function createTranscriptService(options: TranscriptServiceOptions) {
  function fileForId(id: string): { id: string; file: string } {
    const base = path.basename(id.endsWith(".md") ? id : `${id}.md`);
    return {
      id: idFromFile(base),
      file: path.join(options.transcriptsDir, base),
    };
  }

  async function ensureDir() {
    await mkdir(options.transcriptsDir, { recursive: true });
  }

  async function readTranscript(id: string, file: string): Promise<Transcript> {
    try {
      const raw = await readFile(file, "utf8");
      return parseMarkdown(id, raw);
    } catch (error) {
      if (isNotFound(error)) {
        throw new TranscriptNotFoundError(id);
      }
      throw error;
    }
  }

  async function list(): Promise<Transcript[]> {
    await ensureDir();
    const names = await readdir(options.transcriptsDir);
    const files = names
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .sort((a, b) => a.localeCompare(b));
    const transcripts: Transcript[] = [];
    for (const name of files) {
      transcripts.push(
        await readTranscript(
          idFromFile(name),
          path.join(options.transcriptsDir, name),
        ),
      );
    }
    return transcripts;
  }

  async function get(id: string): Promise<Transcript> {
    await ensureDir();
    const target = fileForId(id);
    return readTranscript(target.id, target.file);
  }

  return { list, get, ensureDir };
}

export type TranscriptService = ReturnType<typeof createTranscriptService>;
