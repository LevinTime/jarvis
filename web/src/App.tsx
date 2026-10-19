import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { CalendarDays, House, ListChecks, MessageCircle, SquareTerminal } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { DEFAULT_T3_URL, DEFAULT_WIDGETS, normalizeSettings, type AppSettings, type WidgetItem } from "../../src/settings/model.ts";
import { ApiError, api } from "./api.ts";
import { applyAppearance, readLocalSettings, writeLocalSettings } from "./appearance.ts";
import { useLiveFeed } from "./feed.ts";
import { useI18n } from "./i18n/index.ts";
import { Chat } from "./pages/Chat.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { MemoryPage } from "./pages/Memory.tsx";
import { Settings } from "./pages/Settings.tsx";
import { T3Page } from "./pages/T3.tsx";
import { Todos } from "./pages/Todos.tsx";
import type { ChatMessage, JarvisEvent, Note, StatusResponse, Task, TaskStatus } from "./types.ts";
import { allowPageDrag } from "@jarvis/gesture.ts";
import { Lamp, Skeleton, pulse } from "./ui.tsx";

const CalendarPage = lazy(() => import("./pages/Calendar.tsx"));
const UsagePage = lazy(() => import("./pages/Usage.tsx"));

const PAGES = [
  { id: "calendar", Icon: CalendarDays },
  { id: "today", Icon: House },
  { id: "tasks", Icon: ListChecks },
  { id: "chat", Icon: MessageCircle },
  { id: "t3", Icon: SquareTerminal },
] as const;

type SettingsResponse = {
  settings: AppSettings;
  effectiveT3Url: string;
  defaultT3Url: string;
};

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
  const t = useI18n();
  const [settings, setSettings] = useState<AppSettings>(readLocalSettings);
  const [t3Field, setT3Field] = useState(() => readLocalSettings().t3Url || DEFAULT_T3_URL);
  const [defaultT3, setDefaultT3] = useState(DEFAULT_T3_URL);
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [mistakeStamp, setMistakeStamp] = useState(0);
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
  const dockRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const dirty = useRef(false);
  const pageRef = useRef(1);
  const reduce = settings.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [emblaRef, embla] = useEmblaCarousel({
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: 1,
    startIndex: 1,
    duration: reduce ? 0 : 22,
    watchDrag: (_api, event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return true;
      }
      const point = "clientX" in event ? Number(event.clientX) : 0;
      return allowPageDrag(target, point, window.innerWidth);
    },
  });
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    applyAppearance(settings);
    writeLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    let cancel = false;
    void api<SettingsResponse>("/api/settings")
      .then((body) => {
        if (cancel) {
          return;
        }
        setDefaultT3(body.defaultT3Url || DEFAULT_T3_URL);
        if (dirty.current) {
          return;
        }
        const next = normalizeSettings(body.settings);
        setSettings(next);
        setT3Field(next.t3Url || body.defaultT3Url || DEFAULT_T3_URL);
        writeLocalSettings(next);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
    }
  }, []);

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
    const paint = () => {
      const snaps = Math.max(1, embla.scrollSnapList().length);
      const value = embla.scrollProgress() * (snaps - 1);
      dockRef.current?.style.setProperty("--nav", String(Number.isFinite(value) ? value : 1));
    };
    let armed = false;
    const select = () => {
      const next = embla.selectedScrollSnap();
      if (armed && next !== pageRef.current) {
        pulse();
      }
      armed = true;
      pageRef.current = next;
      setIndex(next);
      if (next === 0) {
        setSeenCalendar(true);
      }
      paint();
    };
    embla.on("select", select);
    embla.on("scroll", paint);
    embla.on("reInit", select);
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) {
        return;
      }
      width = window.innerWidth;
      embla.reInit();
      select();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    select();
    return () => {
      embla.off("select", select);
      embla.off("scroll", paint);
      embla.off("reInit", select);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [embla]);

  function scheduleSave(next: AppSettings) {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
    }
    saveTimer.current = window.setTimeout(() => {
      void api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ settings: next }),
      }).catch(() => undefined);
    }, 350);
  }

  function updateSettings(patch: Partial<AppSettings>) {
    dirty.current = true;
    setSettings((current) => {
      try {
        const next = normalizeSettings({ ...current, ...patch }, current);
        scheduleSave(next);
        return next;
      } catch {
        return current;
      }
    });
  }

  function onT3(value: string) {
    setT3Field(value);
    const trimmed = value.trim().replace(/\/$/, "");
    const fallback = defaultT3.replace(/\/$/, "");
    updateSettings({ t3Url: !trimmed || trimmed === fallback ? "" : trimmed });
  }

  function go(next: number) {
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
        <h1>{t("offline.title")}</h1>
        <p>{t("offline.body")}</p>
        <button type="button" className="text-btn" onClick={() => void load()}>
          {t("offline.retry")}
        </button>
      </main>
    );
  }

  const effectiveT3 = settings.t3Url || defaultT3;

  return (
    <div className="app">
      {needRefresh ? (
        <div className="update">
          <span>{t("update.ready")}</span>
          <button type="button" className="text-btn" onClick={() => void updateServiceWorker(true)}>
            {t("update.reload")}
          </button>
        </div>
      ) : null}
      <div className="viewport" ref={emblaRef}>
        <div className="track">
          <section className="slide" role="region" aria-label={t("nav.calendar")}>
            {seenCalendar || index === 0 ? (
              <Suspense fallback={<Skeleton lines={6} />}>
                <CalendarPage revision={revision} />
              </Suspense>
            ) : (
              <Skeleton lines={4} />
            )}
          </section>
          <section className="slide" role="region" aria-label={t("nav.today")}>
            <Dashboard
              status={status}
              tasks={tasks}
              notes={notes}
              messages={messages}
              loading={loading}
              error={error}
              connection={connection}
              widgets={settings.widgets}
              editing={editing}
              onEditing={setEditing}
              onWidgets={(items: WidgetItem[]) => updateSettings({ widgets: items })}
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
              onCreate={createTask}
              onSettings={() => setSettingsOpen(true)}
              onMemory={() => setMemoryOpen(true)}
              mistakeStamp={mistakeStamp}
            />
          </section>
          <section className="slide" role="region" aria-label={t("nav.tasks")}>
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
          <section className="slide chat-slide" role="region" aria-label={t("nav.chat")}>
            <Chat
              messages={messages}
              loading={loading}
              error={error}
              onSend={send}
              onOlder={older}
              onCorrected={() => setMistakeStamp((value) => value + 1)}
            />
          </section>
          <section className="slide" role="region" aria-label={t("nav.t3")}>
            <T3Page url={effectiveT3} />
          </section>
        </div>
      </div>
      <nav className="dock-wrap" aria-label={t("nav.pages")}>
        <div className="dock" ref={dockRef}>
          <span className="nav-indicator" aria-hidden="true" />
          {PAGES.map((page, pageIndex) => (
            <button
              key={page.id}
              type="button"
              aria-current={index === pageIndex ? "page" : undefined}
              onClick={() => go(pageIndex)}
            >
              <page.Icon strokeWidth={1.75} aria-hidden="true" />
              {page.id === "calendar"
                ? t("nav.calendar")
                : page.id === "today"
                  ? t("nav.today")
                  : page.id === "tasks"
                    ? t("nav.tasks")
                    : page.id === "chat"
                      ? t("nav.chat")
                      : t("nav.t3")}
            </button>
          ))}
        </div>
      </nav>
      {settingsOpen ? (
        <Settings
          settings={settings}
          t3Field={t3Field}
          onChange={updateSettings}
          onT3={onT3}
          onClose={() => setSettingsOpen(false)}
          onReset={() => updateSettings({ widgets: DEFAULT_WIDGETS.map((item) => ({ ...item })) })}
          onMemory={() => setMemoryOpen(true)}
        />
      ) : null}
      {memoryOpen ? (
        <MemoryPage
          onClose={() => {
            setMemoryOpen(false);
            setMistakeStamp((value) => value + 1);
          }}
        />
      ) : null}
      {usageOpen ? (
        <div className="sheet-root" onClick={() => setUsageOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={t("dash.cost")} onClick={(event) => event.stopPropagation()}>
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
