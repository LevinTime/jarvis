import type { ChatMessage } from "./messages/store.ts";
import type { Note } from "./notes/service.ts";
import type { Task } from "./tasks/service.ts";
import type { UsageEntry } from "./usage/types.ts";

export type JarvisEvent =
  | {
      id: number;
      ts: string;
      type: "message:new" | "message:updated";
      message: ChatMessage;
    }
  | {
      id: number;
      ts: string;
      type: "task:changed";
      action: "created" | "updated" | "deleted";
      taskId: string;
      task?: Task;
    }
  | {
      id: number;
      ts: string;
      type: "note:changed";
      action: "added" | "closed";
      noteId: string;
      note?: Note;
    }
  | {
      id: number;
      ts: string;
      type: "usage:new";
      entry: UsageEntry;
    }
  | {
      id: number;
      ts: string;
      type: "status:changed";
      telegramConnected: boolean;
      llmConfigured: boolean;
    };

export type JarvisEventInput =
  | {
      type: "message:new" | "message:updated";
      message: ChatMessage;
    }
  | {
      type: "task:changed";
      action: "created" | "updated" | "deleted";
      taskId: string;
      task?: Task;
    }
  | {
      type: "note:changed";
      action: "added" | "closed";
      noteId: string;
      note?: Note;
    }
  | {
      type: "usage:new";
      entry: UsageEntry;
    }
  | {
      type: "status:changed";
      telegramConnected: boolean;
      llmConfigured: boolean;
    };

type Listener = (event: JarvisEvent) => void;

export function createEventBus(options: { capacity?: number; now?: () => Date } = {}) {
  const capacity = options.capacity ?? 500;
  const now = options.now ?? (() => new Date());
  const buffer: JarvisEvent[] = [];
  const listeners = new Set<Listener>();
  const aborters = new Set<() => void>();
  let nextId = 1;
  let closed = false;

  function emit(input: JarvisEventInput): JarvisEvent {
    const event = {
      ...input,
      id: nextId,
      ts: now().toISOString(),
    } as JarvisEvent;
    nextId += 1;
    buffer.push(event);
    if (buffer.length > capacity) {
      buffer.splice(0, buffer.length - capacity);
    }
    for (const listener of listeners) {
      listener(event);
    }
    return event;
  }

  function since(lastId: number): { events: JarvisEvent[]; resync: boolean } {
    if (!Number.isFinite(lastId) || lastId <= 0) {
      return { events: [], resync: false };
    }
    const oldest = buffer[0]?.id;
    if (oldest === undefined) {
      return { events: [], resync: lastId < nextId - 1 };
    }
    if (lastId < oldest - 1) {
      return { events: [], resync: true };
    }
    return {
      events: buffer.filter((event) => event.id > lastId),
      resync: false,
    };
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function onClose(abort: () => void): () => void {
    aborters.add(abort);
    return () => {
      aborters.delete(abort);
    };
  }

  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    for (const abort of aborters) {
      abort();
    }
    aborters.clear();
    listeners.clear();
  }

  return {
    emit,
    since,
    subscribe,
    onClose,
    close,
    latestId: () => nextId - 1,
    listenerCount: () => listeners.size,
  };
}

export type EventBus = ReturnType<typeof createEventBus>;
