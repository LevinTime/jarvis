import { randomUUID } from "node:crypto";
import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { parseJson, readText, writeTextAtomic } from "../atomic-file.ts";
import { createMutex } from "../mutex.ts";

export type ChatSource = "telegram" | "web" | "system";
export type ChatRole = "user" | "assistant";
export type ChatStatus = "pending" | "done" | "error";

export type ChatMessage = {
  id: string;
  clientId?: string;
  ts: string;
  source: ChatSource;
  role: ChatRole;
  text: string;
  status?: ChatStatus;
  error?: string;
};

export type MessageDraft = {
  id?: string;
  clientId?: string;
  ts?: string;
  source: ChatSource;
  role: ChatRole;
  text: string;
  status?: ChatStatus;
  error?: string;
};

export class MessageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageValidationError";
  }
}

type MessageStoreOptions = {
  dataDir: string;
  now?: () => Date;
  maxText?: number;
  rotateAt?: number;
  keep?: number;
};

const LEGACY_FILES = ["history.json", "chat-history.json"];

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isSource(value: string): value is ChatSource {
  return value === "telegram" || value === "web" || value === "system";
}

function isRole(value: string): value is ChatRole {
  return value === "user" || value === "assistant";
}

function isStatus(value: string): value is ChatStatus {
  return value === "pending" || value === "done" || value === "error";
}

export function createMessageStore(options: MessageStoreOptions) {
  const file = path.join(options.dataDir, "messages.json");
  const archiveDir = path.join(options.dataDir, "archive");
  const nowIso = () => (options.now ?? (() => new Date()))().toISOString();
  const maxText = options.maxText ?? 4000;
  const rotateAt = options.rotateAt ?? 5000;
  const keep = options.keep ?? 4000;
  const mutex = createMutex();
  let migrated = false;

  async function readAll(): Promise<{ messages: ChatMessage[]; exists: boolean }> {
    try {
      const raw = await readText(file);
      const parsed = parseJson(raw, "messages.json");
      if (!Array.isArray(parsed)) {
        throw new Error("messages.json ist kein Array");
      }
      return { messages: parsed as ChatMessage[], exists: true };
    } catch (error) {
      if (isNotFound(error)) {
        return { messages: [], exists: false };
      }
      throw error;
    }
  }

  async function writeAll(messages: ChatMessage[]): Promise<void> {
    await writeTextAtomic(file, `${JSON.stringify(messages, null, 2)}\n`);
  }

  function legacyMessage(value: unknown): ChatMessage | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const text =
      typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";
    if (!text.trim()) {
      return null;
    }
    const role = typeof record.role === "string" && isRole(record.role) ? record.role : "user";
    const source =
      typeof record.source === "string" && isSource(record.source) ? record.source : "system";
    const ts = typeof record.ts === "string" ? record.ts : nowIso();
    const id = typeof record.id === "string" && record.id.trim() ? record.id : randomUUID();
    const clientId = typeof record.clientId === "string" ? record.clientId : undefined;
    return {
      id,
      ts,
      source,
      role,
      text,
      status: "done",
      ...(clientId ? { clientId } : {}),
    };
  }

  async function readLegacyFile(name: string): Promise<ChatMessage[]> {
    const full = path.join(options.dataDir, name);
    try {
      const raw = await readText(full);
      const parsed = parseJson(raw, name);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { messages?: unknown }).messages)
          ? (parsed as { messages: unknown[] }).messages
          : [];
      const messages = list
        .map((item) => legacyMessage(item))
        .filter((item): item is ChatMessage => item !== null);
      await rename(full, `${full}.migrated`).catch(() => undefined);
      return messages;
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  async function load(): Promise<ChatMessage[]> {
    const current = await readAll();
    if (migrated) {
      return current.messages;
    }
    migrated = true;
    if (current.exists) {
      return current.messages;
    }
    const imported: ChatMessage[] = [];
    for (const name of LEGACY_FILES) {
      imported.push(...(await readLegacyFile(name)));
    }
    if (imported.length > 0) {
      await writeAll(imported);
    }
    return imported;
  }

  async function archive(messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }
    await mkdir(archiveDir, { recursive: true });
    const stamp = (messages[0]?.ts ?? nowIso()).replace(/[:.]/g, "-");
    const target = path.join(archiveDir, `messages-${stamp}-${randomUUID().slice(0, 8)}.json`);
    await writeTextAtomic(target, `${JSON.stringify(messages, null, 2)}\n`);
  }

  function findCursor(messages: ChatMessage[], cursor: string | undefined, side: "before" | "since"): ChatMessage[] {
    if (!cursor) {
      return messages;
    }
    const index = messages.findIndex((message) => message.id === cursor);
    if (index >= 0) {
      return side === "before" ? messages.slice(0, index) : messages.slice(index + 1);
    }
    return messages.filter((message) =>
      side === "before" ? message.ts < cursor : message.ts > cursor,
    );
  }

  async function append(draft: MessageDraft): Promise<{ message: ChatMessage; created: boolean }> {
    const text = draft.text?.trim() ?? "";
    if (!text) {
      throw new MessageValidationError("text darf nicht leer sein");
    }
    if (text.length > maxText) {
      throw new MessageValidationError(`Nachricht ist zu lang (höchstens ${maxText} Zeichen).`);
    }
    if (!isSource(draft.source) || !isRole(draft.role)) {
      throw new MessageValidationError("source oder role ist ungültig");
    }
    return mutex.exclusive(async () => {
      const messages = await load();
      if (draft.clientId) {
        const existing = messages.find((message) => message.clientId === draft.clientId);
        if (existing) {
          return { message: existing, created: false };
        }
      }
      const message: ChatMessage = {
        id: draft.id?.trim() || randomUUID(),
        ts: draft.ts ?? nowIso(),
        source: draft.source,
        role: draft.role,
        text,
        ...(draft.clientId ? { clientId: draft.clientId } : {}),
        ...(draft.status ? { status: draft.status } : {}),
        ...(draft.error ? { error: draft.error } : {}),
      };
      messages.push(message);
      if (messages.length > rotateAt) {
        const archived = messages.splice(0, messages.length - keep);
        await archive(archived);
      }
      await writeAll(messages);
      return { message, created: true };
    });
  }

  async function list(query: { since?: string; before?: string; limit?: number } = {}): Promise<ChatMessage[]> {
    return mutex.exclusive(async () => {
      let messages = await load();
      messages = findCursor(messages, query.since, "since");
      messages = findCursor(messages, query.before, "before");
      const limit = query.limit ?? 50;
      if (limit >= 0 && messages.length > limit) {
        messages = messages.slice(messages.length - limit);
      }
      return messages;
    });
  }

  async function findByClientId(clientId: string): Promise<ChatMessage | null> {
    return mutex.exclusive(async () => {
      const messages = await load();
      return messages.find((message) => message.clientId === clientId) ?? null;
    });
  }

  async function updateStatus(
    id: string,
    status: ChatStatus,
    error?: string,
  ): Promise<ChatMessage> {
    if (!isStatus(status)) {
      throw new MessageValidationError("status ist ungültig");
    }
    return mutex.exclusive(async () => {
      const messages = await load();
      const index = messages.findIndex((message) => message.id === id);
      const current = index >= 0 ? messages[index] : undefined;
      if (!current) {
        throw new MessageValidationError(`Nachricht nicht gefunden: ${id}`);
      }
      const next: ChatMessage = {
        ...current,
        status,
        ...(error ? { error } : { error: undefined }),
      };
      if (!error) {
        delete next.error;
      }
      messages[index] = next;
      await writeAll(messages);
      return next;
    });
  }

  async function recoverPending(reason = "Die Antwort wurde unterbrochen."): Promise<ChatMessage[]> {
    return mutex.exclusive(async () => {
      const messages = await load();
      const recovered: ChatMessage[] = [];
      let changed = false;
      for (let index = 0; index < messages.length; index += 1) {
        const current = messages[index];
        if (!current || current.status !== "pending") {
          continue;
        }
        const next: ChatMessage = { ...current, status: "error", error: reason };
        messages[index] = next;
        recovered.push(next);
        changed = true;
      }
      if (changed) {
        await writeAll(messages);
      }
      return recovered;
    });
  }

  return {
    append,
    list,
    findByClientId,
    updateStatus,
    recoverPending,
    drain: () => mutex.drain(),
  };
}

export type MessageStore = ReturnType<typeof createMessageStore>;
