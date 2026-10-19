import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { ApiError, api } from "./api.ts";
import { useLiveFeed } from "./feed.ts";
import { Chat } from "./pages/Chat.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Todos } from "./pages/Todos.tsx";
import type { ChatMessage, JarvisEvent, Note, StatusResponse, Task, TaskStatus } from "./types.ts";
import { Lamp, Skeleton, pulse } from "./ui.tsx";

const CalendarPage = lazy(() => import("./pages/Calendar.tsx"));
const UsagePage = lazy(() => import("./pages/Usage.tsx"));

type ThemeChoice = "dark" | "light" | "system";
const THEMES: ThemeChoice[] = ["dark", "light", "system"];
const THEME_LABEL: Record<ThemeChoice, string> = {
  dark: "Dunkel",
  light: "Hell",
  system: "System",
};

function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem("jarvis-theme");
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    /* private mode */
  }
  return "dark";
}

function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = choice;
  const light =
    choice === "light" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#f6f0e8" : "#12100e");
  try {
    localStorage.setItem("jarvis-theme", choice);
  } catch {
    /* ignore */
  }
}

function upsertMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = list.findIndex(
    (item) => item.id === message.id || (Boolean(message.clientId) && item.clientId === message.clientId),
  );
  const next = list.slice();
  if (index >= 0) {
    next[index] = message;
  } else {
    next.push(message);
  }
  next.sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
  return next;
}

export function App() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const [index, setIndex] = useState(1);
  const [seenCalendar, setSeenCalendar] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [revision, setRevision] = useState(0);
  const [usageStamp, setUsageStamp] = useState(0);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [emblaRef, embla] = useEmblaCarousel({
    startIndex: 1,
    duration: reduce ? 0 : 22,
    watchDrag: (_api, event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return true;
      }
      return !target.closest("[data-no-swipe], input, textarea, select");
    },
  });
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }
    const sync = () => {
      document.documentElement.style.setProperty("--vvh", `${viewport.height}px`);
      document.documentElement.style.setProperty("--vv-top", `${viewport.offsetTop}px`);
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const [nextStatus, taskBody, noteBody, messageBody] = await Promise.all([
        api<StatusResponse>("/api/status"),
        api<{ tasks: Task[] }>("/api/tasks"),
        api<{ notes: Note[] }>("/api/notes"),
        api<{ messages: ChatMessage[] }>("/api/messages?limit=40"),
      ]);
      setStatus(nextStatus);
      setTasks(taskBody.tasks);
      setNotes(noteBody.notes);
      setMessages(messageBody.messages);
      setError(null);
      setOffline(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 0) {
        setOffline(true);
      }
      setError(caught instanceof Error ? caught.message : "Laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onEvent = useCallback((event: JarvisEvent) => {
    if ((event.type === "message:new" || event.type === "message:updated") && event.message) {
      const message = event.message;
      setMessages((list) => upsertMessage(list, message));
    }
    if (event.type === "task:changed") {
      setRevision((value) => value + 1);
      setTasks((list) => {
        if (event.action === "deleted" && event.taskId) {
          return list.filter((task) => task.id !== event.taskId);
        }
        if (!event.task) {
          return list;
        }
        const task = event.task;
        const found = list.findIndex((item) => item.id === task.id);
        if (found < 0) {
          return [...list, task];
        }
        const next = list.slice();
        next[found] = task;
        return next;
      });
    }
    if (event.type === "note:changed") {
      setNotes((list) => {
        if (event.action === "closed" && event.noteId) {
          return list.filter((note) => note.id !== event.noteId);
        }
        if (!event.note?.offen) {
          return list;
        }
        const note = event.note;
        const found = list.findIndex((item) => item.id === note.id);
        if (found < 0) {
          return [note, ...list];
        }
        const next = list.slice();
        next[found] = note;
        return next;
      });
    }
    if (event.type === "status:changed") {
      setStatus((current) =>
        current
          ? {
              ...current,
              telegram: { ...current.telegram, connected: Boolean(event.telegramConnected) },
              llm: { ...current.llm, configured: event.llmConfigured ?? current.llm.configured },
            }
          : current,
      );
    }
    if (event.type === "usage:new") {
      setUsageStamp((value) => value + 1);
      void api<StatusResponse>("/api/status")
        .then((next) => setStatus(next))
        .catch(() => undefined);
    }
  }, []);

  const connection = useLiveFeed(onEvent, () => {
    void load();
  });

  useEffect(() => {
    if (!embla) {
      return;
    }
    const select = () => setIndex(embla.selectedScrollSnap());
    embla.on("select", select);
    return () => {
      embla.off("select", select);
    };
  }, [embla]);

  function go(next: number) {
    pulse();
    setIndex(next);
    if (next === 0) {
      setSeenCalendar(true);
    }
    embla?.scrollTo(next);
  }

  async function send(text: string) {
    const clientId = crypto.randomUUID();
    const optimistic: ChatMessage = {
      id: `local-${clientId}`,
      clientId,
      ts: new Date().toISOString(),
      source: "web",
      role: "user",
      text,
      status: "pending",
    };
    setMessages((list) => upsertMessage(list, optimistic));
    try {
      const result = await api<{ message: ChatMessage }>("/api/chat", {
        method: "POST",
        body: JSON.stringify({ text, clientId }),
      });
      setMessages((list) => upsertMessage(list, result.message));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Nicht gesendet.";
      setMessages((list) =>
        list.map((item) => (item.clientId === clientId ? { ...item, status: "error", error: message } : item)),
      );
    }
  }

  async function older(before: string): Promise<ChatMessage[]> {
    const body = await api<{ messages: ChatMessage[] }>(
      `/api/messages?before=${encodeURIComponent(before)}&limit=40`,
    );
    setMessages((list) => {
      const known = new Set(list.map((item) => item.id));
      return [...body.messages.filter((item) => !known.has(item.id)), ...list].sort(
        (a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id),
      );
    });
    return body.messages;
  }

  async function createTask(input: { titel: string; faelligAm?: string; wiederholung?: string }) {
    const body = await api<{ task: Task }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        titel: input.titel,
        aufgabe: input.titel,
        ...(input.faelligAm ? { faelligAm: input.faelligAm } : {}),
        ...(input.wiederholung ? { wiederholung: input.wiederholung } : {}),
      }),
    });
    setTasks((list) => (list.some((task) => task.id === body.task.id) ? list : [...list, body.task]));
  }

  async function patchTask(
    id: string,
    patch: { titel?: string; faelligAm?: string | null; wiederholung?: string | null; status?: TaskStatus },
  ) {
    const body = await api<{ task: Task }>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setTasks((list) => list.map((task) => (task.id === body.task.id ? body.task : task)));
  }

  async function deleteTask(id: string) {
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    setTasks((list) => list.filter((task) => task.id !== id));
  }

  if (offline && !status) {
    return (
      <main className="offline">
        <Lamp className="lg" />
        <h1>Jarvis ist gerade nicht da</h1>
        <p>Der PC ist aus oder Tailscale hat keine Verbindung. Sobald er wieder erreichbar ist, geht es hier weiter.</p>
        <button type="button" className="text-btn" onClick={() => void load()}>
          Nochmal versuchen
        </button>
      </main>
    );
  }

  const pages = [
    { id: "calendar", label: "Kalender", icon: "cal" },
    { id: "today", label: "Heute", icon: "home" },
    { id: "tasks", label: "Aufgaben", icon: "check" },
    { id: "chat", label: "Chat", icon: "chat" },
  ] as const;

  return (
    <div className="app">
      {needRefresh ? (
        <div className="update">
          <span>Update verfügbar</span>
          <button type="button" className="text-btn" onClick={() => void updateServiceWorker(true)}>
            Neu laden
          </button>
        </div>
      ) : null}
      <div className="viewport" ref={emblaRef}>
        <div className="track">
          <section className="slide" aria-label="Kalender">
            {seenCalendar || index === 0 ? (
              <Suspense fallback={<Skeleton lines={6} />}>
                <CalendarPage revision={revision} />
              </Suspense>
            ) : (
              <Skeleton lines={4} />
            )}
          </section>
          <section className="slide" aria-label="Heute">
            <Dashboard
              status={status}
              tasks={tasks}
              notes={notes}
              messages={messages}
              loading={loading}
              error={error}
              connection={connection}
              themeLabel={THEME_LABEL[theme]}
              onOpen={go}
              onUsage={() => {
                pulse();
                setUsageOpen(true);
              }}
              onRefresh={() => void load()}
              onCloseNote={async (id) => {
                await api(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify({ offen: false }) });
                setNotes((list) => list.filter((note) => note.id !== id));
              }}
              onTheme={() => {
                const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length] ?? "dark";
                setTheme(next);
              }}
            />
          </section>
          <section className="slide" aria-label="Aufgaben">
            <Todos
              tasks={tasks}
              loading={loading}
              error={error}
              onRefresh={() => void load()}
              onCreate={createTask}
              onPatch={patchTask}
              onDelete={deleteTask}
            />
          </section>
          <section className="slide chat-slide" aria-label="Chat">
            <Chat
              messages={messages}
              loading={loading}
              error={error}
              onSend={send}
              onOlder={older}
            />
          </section>
        </div>
      </div>
      <nav className="tabs" aria-label="Seiten">
        {pages.map((page, pageIndex) => (
          <button
            key={page.id}
            type="button"
            aria-current={index === pageIndex ? "page" : undefined}
            onClick={() => go(pageIndex)}
          >
            <TabIcon name={page.icon} />
            {page.label}
          </button>
        ))}
      </nav>
      {usageOpen ? (
        <div className="sheet-root" onClick={() => setUsageOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Kosten" onClick={(event) => event.stopPropagation()}>
            <div className="sheet-bar" />
            <Suspense fallback={<Skeleton lines={4} />}>
              <UsagePage stamp={usageStamp} />
            </Suspense>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabIcon({ name }: { name: "cal" | "home" | "check" | "chat" }) {
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12.5 9.2 17 19 7" fill="none" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  if (name === "chat") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 6h14v9H8l-3 3z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4 9h16M8 3v4M16 3v4" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}
