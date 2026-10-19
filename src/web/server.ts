import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { serveStatic } from "hono/serve-static";
import { streamSSE } from "hono/streaming";
import type { MessageHandler } from "../assistant.ts";
import type { EventBus, JarvisEvent } from "../events.ts";
import { MessageValidationError, type MessageStore } from "../messages/store.ts";
import {
  NoteNotFoundError,
  NoteValidationError,
  type NoteService,
} from "../notes/service.ts";
import { expandTasks, filterTasks } from "../tasks/calendar.ts";
import { dayKey, isoInZone, startOfDay } from "../tasks/schedule.ts";
import {
  TaskConflictError,
  TaskNotFoundError,
  TaskValidationError,
  type Task,
  type TaskService,
  type TaskStatus,
} from "../tasks/service.ts";
import type { UsageStore } from "../usage/store.ts";
import type { UsageRange } from "../usage/cost.ts";
import { probeT3 } from "../settings/probe.ts";
import { SettingsValidationError, DEFAULT_SETTINGS, readDefaultT3Url } from "../settings/model.ts";
import type { SettingsStore } from "../settings/store.ts";
import { renderHomePage, renderMissingFrontend } from "./page.ts";
import {
  apiError,
  createRateLimit,
  isLocalAddress,
  LEGACY_CSP,
  MAX_BODY_BYTES,
  originAllowed,
  STRICT_CSP,
  tailscaleAllowed,
} from "./security.ts";

export const WEB_HOST = "127.0.0.1";

const RANGES = new Set<UsageRange>(["today", "7d", "month", "30d"]);
const DUE_FILTERS = new Set(["heute", "ueberfaellig", "woche"]);
const TASK_STATUSES = new Set<TaskStatus>(["offen", "in Arbeit", "erledigt", "fehlgeschlagen"]);

export type WebAppOptions = {
  reply: (message: string) => Promise<string>;
  tasks: Pick<TaskService, "list" | "run" | "reset"> &
    Partial<Pick<TaskService, "create" | "update" | "remove" | "get">>;
  notes?: Pick<NoteService, "listOpen" | "close">;
  messages?: Pick<MessageStore, "list">;
  events?: EventBus;
  usage?: Pick<UsageStore, "report">;
  chat?: Pick<MessageHandler, "handleUserMessage">;
  frontendDist?: string;
  allowedTsUser?: string;
  version?: string;
  startedAt?: number;
  timeZone?: string;
  now?: () => Date;
  telegram?: { configured: boolean; connected: boolean; mirror: boolean };
  llm?: { configured: boolean; lastError: () => string | undefined };
  chatPerMinute?: number;
  settings?: SettingsStore;
  t3Url?: string;
};

function errorBody(error: unknown): { status: 400 | 404 | 409 | 500; message: string } {
  if (error instanceof TaskValidationError || error instanceof MessageValidationError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof TaskNotFoundError) {
    return { status: 404, message: error.message };
  }
  if (error instanceof TaskConflictError) {
    return { status: 409, message: error.message };
  }
  if (error instanceof NoteValidationError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof NoteNotFoundError) {
    return { status: 404, message: error.message };
  }
  if (error instanceof SettingsValidationError) {
    return { status: 400, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, message };
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeDue(value: string | undefined, timeZone: string): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return undefined;
  }
  try {
    return isoInZone(trimmed, timeZone);
  } catch (error) {
    const message = error instanceof Error ? error.message : "faelligAm muss ein ISO-Datum sein";
    throw new TaskValidationError(message);
  }
}

async function distReady(distDir: string): Promise<boolean> {
  try {
    return (await stat(path.join(distDir, "index.html"))).isFile();
  } catch {
    return false;
  }
}

function monthWindow(now: Date, timeZone: string): { from: string; to: string } {
  const key = dayKey(now, timeZone);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const from = isoInZone(`${key.slice(0, 7)}-01T00:00:00`, timeZone);
  const to =
    month === 12
      ? isoInZone(`${year + 1}-01-01T00:00:00`, timeZone)
      : isoInZone(`${year}-${String(month + 1).padStart(2, "0")}-01T00:00:00`, timeZone);
  return { from, to };
}

function taskOverview(tasks: Task[], now: Date, timeZone: string) {
  const start = startOfDay(now, timeZone).getTime();
  const todayKey = dayKey(now, timeZone);
  const upcoming = tasks
    .filter((task) => {
      if (task.status !== "offen" || !task.faelligAm) {
        return false;
      }
      const due = Date.parse(task.faelligAm);
      return Number.isFinite(due) && due >= start;
    })
    .sort((a, b) => (a.faelligAm ?? "").localeCompare(b.faelligAm ?? ""))
    .slice(0, 5)
    .map((task) => ({
      id: task.id,
      titel: task.titel,
      faelligAm: task.faelligAm,
      status: task.status,
    }));
  return {
    open: tasks.filter((task) => task.status === "offen").length,
    overdue: tasks.filter((task) => {
      if (task.status === "erledigt" || !task.faelligAm) {
        return false;
      }
      const due = Date.parse(task.faelligAm);
      return Number.isFinite(due) && due < start;
    }).length,
    today: tasks.filter((task) => {
      if (task.status === "erledigt" || !task.faelligAm) {
        return false;
      }
      return dayKey(new Date(task.faelligAm), timeZone) === todayKey;
    }).length,
    upcoming,
  };
}

export function createWebApp(options: WebAppOptions): Hono {
  const app = new Hono();
  const timeZone = options.timeZone ?? "Europe/Berlin";
  const now = () => options.now?.() ?? new Date();
  const startedAt = options.startedAt ?? Date.now();
  const chatLimit = createRateLimit(options.chatPerMinute ?? 30, 60_000);
  let shellHtml: string | null = null;

  app.use("*", async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD") {
      const length = Number(c.req.header("content-length") ?? "0");
      if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
        return c.json(apiError("too_large", "Anfrage ist zu groß."), 413);
      }
      const origin = c.req.header("origin");
      if (origin && !originAllowed(origin, c.req.header("host"))) {
        return c.json(apiError("bad_origin", "Origin nicht erlaubt."), 403);
      }
    }
    if (
      !tailscaleAllowed({
        allowedUser: options.allowedTsUser,
        header: c.req.header("tailscale-user-login"),
        remote: c.req.header("x-jarvis-remote"),
      })
    ) {
      return c.json(apiError("forbidden", "Dieser Tailscale-Benutzer ist nicht erlaubt."), 403);
    }
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    c.header("Content-Security-Policy", STRICT_CSP);
    await next();
  });

  app.get("/api/status", async (c) => {
    try {
      const tasks = await options.tasks.list();
      const notes = options.notes ? await options.notes.listOpen() : [];
      const usage = options.usage ? await options.usage.report("month", now()) : null;
      const telegram = options.telegram ?? { configured: false, connected: false, mirror: false };
      const warning = !telegram.configured
        ? "Telegram nicht verbunden"
        : !telegram.mirror
          ? "ALLOWED_CHAT_ID fehlt, keine Spiegelung"
          : undefined;
      return c.json({
        telegram: { ...telegram, ...(warning ? { warning } : {}) },
        llm: {
          configured: options.llm?.configured ?? false,
          lastError: options.llm?.lastError() ?? null,
        },
        uptimeSec: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
        version: options.version ?? "0.1.0",
        tasks: taskOverview(tasks, now(), timeZone),
        usage: usage
          ? {
              todayUsd: usage.today.costUsd,
              monthUsd: usage.month.costUsd,
              budget: usage.budget,
              pricesAreEstimates: true,
            }
          : null,
        notes: { open: notes.length },
      });
    } catch (error) {
      const body = errorBody(error);
      return c.json({ error: body.message }, body.status);
    }
  });

  app.get("/api/tasks", async (c) => {
    try {
      const status = c.req.query("status");
      const faellig = c.req.query("faellig");
      if (status && !TASK_STATUSES.has(status as TaskStatus)) {
        return c.json(apiError("invalid", "status ist ungültig"), 400);
      }
      if (faellig && !DUE_FILTERS.has(faellig)) {
        return c.json(apiError("invalid", "faellig ist ungültig"), 400);
      }
      const tasks = filterTasks(
        await options.tasks.list(),
        {
          ...(status ? { status } : {}),
          ...(faellig ? { faellig } : {}),
        },
        now(),
        timeZone,
      );
      return c.json({ tasks });
    } catch (error) {
      const body = errorBody(error);
      return c.json({ error: body.message }, body.status);
    }
  });

  app.post("/api/tasks", async (c) => {
    if (!options.tasks.create) {
      return c.json(apiError("unavailable", "Anlegen ist nicht verfügbar"), 501);
    }
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(apiError("invalid", "JSON ungültig"), 400);
    }
    const body = record(payload);
    if (!body) {
      return c.json(apiError("invalid", "JSON muss ein Objekt sein"), 400);
    }
    try {
      const task = await options.tasks.create({
        titel: text(body.titel) ?? "",
        aufgabe: text(body.aufgabe) ?? text(body.titel) ?? "",
        faelligAm: normalizeDue(text(body.faelligAm), timeZone),
        wiederholung: text(body.wiederholung) ?? null,
      });
      return c.json({ task }, 201);
    } catch (error) {
      const failed = errorBody(error);
      return c.json(apiError(failed.status === 400 ? "invalid" : "error", failed.message), failed.status);
    }
  });

  app.patch("/api/tasks/:id", async (c) => {
    if (!options.tasks.update) {
      return c.json(apiError("unavailable", "Ändern ist nicht verfügbar"), 501);
    }
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(apiError("invalid", "JSON ungültig"), 400);
    }
    const body = record(payload);
    if (!body) {
      return c.json(apiError("invalid", "JSON muss ein Objekt sein"), 400);
    }
    const status = text(body.status);
    if (status !== undefined && !TASK_STATUSES.has(status as TaskStatus)) {
      return c.json(apiError("invalid", "status ist ungültig"), 400);
    }
    try {
      const faelligRaw = body.faelligAm;
      const task = await options.tasks.update(c.req.param("id"), {
        ...(text(body.titel) !== undefined ? { titel: text(body.titel) } : {}),
        ...(text(body.aufgabe) !== undefined ? { aufgabe: text(body.aufgabe) } : {}),
        ...(faelligRaw === null
          ? { faelligAm: null }
          : text(faelligRaw) !== undefined
            ? { faelligAm: normalizeDue(text(faelligRaw), timeZone) ?? null }
            : {}),
        ...(body.wiederholung === null
          ? { wiederholung: null }
          : text(body.wiederholung) !== undefined
            ? { wiederholung: text(body.wiederholung) ?? null }
            : {}),
        ...(status ? { status: status as TaskStatus } : {}),
      });
      return c.json({ task });
    } catch (error) {
      const failed = errorBody(error);
      const code = failed.status === 404 ? "not_found" : failed.status === 409 ? "conflict" : "invalid";
      return c.json(apiError(code, failed.message), failed.status);
    }
  });

  app.delete("/api/tasks/:id", async (c) => {
    if (!options.tasks.remove) {
      return c.json(apiError("unavailable", "Löschen ist nicht verfügbar"), 501);
    }
    try {
      await options.tasks.remove(c.req.param("id"));
      return c.json({ ok: true });
    } catch (error) {
      const failed = errorBody(error);
      return c.json(apiError(failed.status === 404 ? "not_found" : "error", failed.message), failed.status);
    }
  });

  app.post("/api/tasks/:id/complete", async (c) => {
    try {
      const task = await options.tasks.run(c.req.param("id"));
      return c.json({ task });
    } catch (error) {
      const body = errorBody(error);
      return c.json({ error: body.message }, body.status);
    }
  });

  app.post("/api/tasks/:id/reset", async (c) => {
    try {
      const task = await options.tasks.reset(c.req.param("id"));
      return c.json({ task });
    } catch (error) {
      const body = errorBody(error);
      return c.json({ error: body.message }, body.status);
    }
  });

  app.get("/api/notes", async (c) => {
    try {
      const notes = options.notes ? await options.notes.listOpen() : [];
      return c.json({ notes });
    } catch (error) {
      const body = errorBody(error);
      return c.json({ error: body.message }, body.status);
    }
  });

  app.post("/api/notes/:id/close", async (c) => {
    if (!options.notes) {
      return c.json({ error: "Notizen sind nicht verfügbar" }, 404);
    }
    try {
      const note = await options.notes.close(c.req.param("id"));
      return c.json({ note });
    } catch (error) {
      const body = errorBody(error);
      return c.json({ error: body.message }, body.status);
    }
  });

  app.patch("/api/notes/:id", async (c) => {
    if (!options.notes) {
      return c.json(apiError("not_found", "Notizen sind nicht verfügbar"), 404);
    }
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(apiError("invalid", "JSON ungültig"), 400);
    }
    const body = record(payload);
    if (!body || body.offen !== false) {
      return c.json(apiError("invalid", "Nur das Schließen ist möglich."), 400);
    }
    try {
      const note = await options.notes.close(c.req.param("id"));
      return c.json({ note });
    } catch (error) {
      const failed = errorBody(error);
      return c.json(apiError(failed.status === 404 ? "not_found" : "invalid", failed.message), failed.status);
    }
  });

  app.get("/api/calendar", async (c) => {
    try {
      const fallback = monthWindow(now(), timeZone);
      const from = isoInZone(c.req.query("from")?.trim() || fallback.from, timeZone);
      const to = isoInZone(c.req.query("to")?.trim() || fallback.to, timeZone);
      const items = expandTasks(await options.tasks.list(), from, to, timeZone);
      return c.json({ from, to, items });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Zeitraum ungültig";
      return c.json(apiError("invalid", message), 400);
    }
  });

  app.post("/api/calendar", async (c) => {
    if (!options.tasks.create) {
      return c.json(apiError("unavailable", "Anlegen ist nicht verfügbar"), 501);
    }
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(apiError("invalid", "JSON ungültig"), 400);
    }
    const body = record(payload);
    if (!body) {
      return c.json(apiError("invalid", "JSON muss ein Objekt sein"), 400);
    }
    try {
      const titel = text(body.titel) ?? "";
      const task = await options.tasks.create({
        titel,
        aufgabe: text(body.aufgabe) ?? titel,
        faelligAm: normalizeDue(text(body.faelligAm), timeZone),
        wiederholung: text(body.wiederholung) ?? null,
      });
      return c.json({ task }, 201);
    } catch (error) {
      const failed = errorBody(error);
      return c.json(apiError("invalid", failed.message), failed.status === 500 ? 500 : 400);
    }
  });

  async function settingsBody() {
    if (!options.settings) {
      const defaultT3Url = readDefaultT3Url(options.t3Url);
      return {
        settings: DEFAULT_SETTINGS,
        effectiveT3Url: defaultT3Url,
        defaultT3Url,
      };
    }
    const settings = await options.settings.get();
    return {
      settings,
      effectiveT3Url: await options.settings.effectiveT3Url(),
      defaultT3Url: options.settings.defaultT3Url(),
    };
  }

  app.get("/api/settings", async (c) => c.json(await settingsBody()));

  app.put("/api/settings", async (c) => {
    if (!options.settings) {
      return c.json(apiError("unavailable", "Einstellungen sind nicht verfügbar"), 501);
    }
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(apiError("invalid", "JSON ungültig"), 400);
    }
    const body = record(payload);
    try {
      await options.settings.save(body?.settings ?? payload);
      return c.json(await settingsBody());
    } catch (error) {
      const failed = errorBody(error);
      return c.json(apiError("invalid", failed.message), failed.status === 500 ? 500 : 400);
    }
  });

  app.get("/api/t3", async (c) => {
    const current = await settingsBody();
    const probe = await probeT3(current.effectiveT3Url);
    return c.json({ url: current.effectiveT3Url, reachable: probe.reachable, status: probe.status });
  });

  app.get("/api/usage", async (c) => {
    const range = (c.req.query("range") ?? "month") as UsageRange;
    if (!RANGES.has(range)) {
      return c.json(apiError("invalid", "range ist ungültig"), 400);
    }
    if (!options.usage) {
      return c.json(apiError("unavailable", "Usage ist nicht verfügbar"), 404);
    }
    return c.json(await options.usage.report(range, now()));
  });

  app.get("/api/messages", async (c) => {
    if (!options.messages) {
      return c.json({ messages: [] });
    }
    const limitRaw = c.req.query("limit");
    let limit = 50;
    if (limitRaw !== undefined) {
      limit = Number(limitRaw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return c.json(apiError("invalid", "limit ist ungültig"), 400);
      }
    }
    const messages = await options.messages.list({
      ...(c.req.query("before") ? { before: c.req.query("before") } : {}),
      ...(c.req.query("since") ? { since: c.req.query("since") } : {}),
      limit,
    });
    return c.json({ messages });
  });

  app.post("/api/chat", async (c) => {
    if (!chatLimit.allow(now().getTime())) {
      return c.json(apiError("rate_limit", "Zu viele Nachrichten. Kurz warten."), 429);
    }
    const length = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
      return c.json(apiError("too_large", "Anfrage ist zu groß."), 413);
    }
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON ungültig" }, 400);
    }
    const body = record(payload);
    const textValue = text(body?.text);
    if (textValue !== undefined) {
      if (!options.chat) {
        return c.json(apiError("unavailable", "Chat ist nicht verfügbar"), 503);
      }
      const clientId = text(body?.clientId)?.trim();
      if (clientId && clientId.length > 80) {
        return c.json(apiError("invalid", "clientId ist zu lang"), 400);
      }
      try {
        const turn = await options.chat.handleUserMessage({
          text: textValue,
          source: "web",
          ...(clientId ? { clientId } : {}),
        });
        return c.json({ message: turn.message, duplicate: turn.duplicate }, 202);
      } catch (error) {
        if (error instanceof MessageValidationError) {
          return c.json(apiError("invalid", error.message), 400);
        }
        const failed = errorBody(error);
        return c.json(apiError("error", failed.message), failed.status);
      }
    }
    const message = text(body?.message)?.trim() ?? "";
    if (!message) {
      return c.json({ error: "message fehlt" }, 400);
    }
    try {
      const reply = await options.reply(message);
      return c.json({ reply });
    } catch (error) {
      const failed = errorBody(error);
      return c.json({ error: failed.message }, failed.status);
    }
  });

  app.get("/api/events", (c) => {
    const events = options.events;
    if (!events) {
      return c.json(apiError("unavailable", "Events sind nicht verfügbar"), 404);
    }
    return streamSSE(c, async (stream) => {
      const lastRaw = c.req.header("last-event-id");
      const lastId = lastRaw ? Number(lastRaw) : 0;
      const sent = new Set<number>();
      const queue: JarvisEvent[] = [];
      let wake: () => void = () => undefined;
      const unsubscribe = events.subscribe((event) => {
        queue.push(event);
        wake();
      });
      const stopClose = events.onClose(() => {
        stream.abort();
        wake();
      });
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const cleanup = () => {
        unsubscribe();
        stopClose();
        if (heartbeat) {
          clearInterval(heartbeat);
        }
      };
      stream.onAbort(() => {
        cleanup();
        wake();
      });
      const caught = events.since(Number.isFinite(lastId) ? lastId : 0);
      if (caught.resync) {
        await stream.writeSSE({
          event: "resync",
          data: "{}",
          id: String(Math.max(events.latestId(), 0)),
        });
      } else {
        for (const event of caught.events) {
          sent.add(event.id);
          await stream.writeSSE({
            event: event.type,
            id: String(event.id),
            data: JSON.stringify(event),
          });
        }
      }
      heartbeat = setInterval(() => {
        void stream.write(": ping\n\n").catch(() => undefined);
      }, 25_000);
      while (!stream.aborted && !stream.closed) {
        const event = queue.shift();
        if (!event) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }
        if (sent.has(event.id)) {
          continue;
        }
        sent.add(event.id);
        await stream.writeSSE({
          event: event.type,
          id: String(event.id),
          data: JSON.stringify(event),
        });
      }
      cleanup();
    });
  });

  async function frontendBody(): Promise<string | null> {
    if (!options.frontendDist) {
      return null;
    }
    if (!(await distReady(options.frontendDist))) {
      return renderMissingFrontend();
    }
    shellHtml ??= await readFile(path.join(options.frontendDist, "index.html"), "utf8");
    return shellHtml;
  }

  app.get("/", async (c) => {
    const html = await frontendBody();
    if (html === null) {
      c.header("Content-Security-Policy", LEGACY_CSP);
      return c.html(renderHomePage());
    }
    c.header("Cache-Control", "no-cache");
    return c.html(html);
  });

  if (options.frontendDist) {
    const distDir = options.frontendDist;
    const files = serveStatic({
      root: distDir,
      join: (...parts) => path.join(...parts),
      getContent: async (filePath) => {
        try {
          return await readFile(filePath);
        } catch {
          return null;
        }
      },
      isDir: async (filePath) => {
        try {
          return (await stat(filePath)).isDirectory();
        } catch {
          return false;
        }
      },
      onFound: (filePath, c) => {
        const base = path.basename(filePath);
        if (
          base === "index.html" ||
          base === "sw.js" ||
          base === "manifest.webmanifest" ||
          base.startsWith("workbox-")
        ) {
          c.header("Cache-Control", "no-cache");
          return;
        }
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    });
    app.use("*", async (c, next) => {
      if (c.req.path.startsWith("/api") || c.req.path === "/") {
        await next();
        return;
      }
      return files(c, next);
    });
  }

  app.notFound(async (c) => {
    if (c.req.path.startsWith("/api")) {
      return c.json(apiError("not_found", "Nicht gefunden"), 404);
    }
    const html = await frontendBody();
    if (html === null) {
      return c.json(apiError("not_found", "Nicht gefunden"), 404);
    }
    c.header("Cache-Control", "no-cache");
    return c.html(html);
  });

  return app;
}

function requestFromNode(req: IncomingMessage, fallbackPort: number): Request {
  const host = req.headers.host ?? `${WEB_HOST}:${fallbackPort}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key.toLowerCase() === "x-jarvis-remote") {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const remote = req.socket.remoteAddress;
  if (remote && isLocalAddress(remote)) {
    headers.set("x-jarvis-remote", remote);
  } else if (remote) {
    headers.set("x-jarvis-remote", remote);
  }
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (hasBody) {
    init.body = Readable.toWeb(req) as ReadableStream;
    init.duplex = "half";
  }
  return new Request(url, init);
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding"]);

function writeWebBody(req: IncomingMessage, res: ServerResponse, response: Response): void {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key)) {
      return;
    }
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  let finished = false;
  const cancel = () => {
    if (finished) {
      return;
    }
    finished = true;
    reader.cancel().catch(() => undefined);
  };
  res.on("close", cancel);
  req.on("aborted", cancel);
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    res.flushHeaders?.();
  }
  void (async () => {
    try {
      while (!finished) {
        const { done, value } = await reader.read();
        if (done || finished || res.destroyed) {
          break;
        }
        const ok = res.write(value);
        if (!ok) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
      finished = true;
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    } catch {
      finished = true;
      if (!res.destroyed) {
        res.destroy();
      }
    }
  })();
}

export function startWebServer(
  app: Hono,
  options: { port?: number } = {},
): Promise<{ port: number; host: string; close: () => Promise<void> }> {
  const port = options.port ?? 3000;
  const sockets = new Set<Socket>();
  const server = createServer(async (req, res) => {
    try {
      const response = await app.fetch(requestFromNode(req, port));
      writeWebBody(req, res, response);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const body = errorBody(error);
      res.statusCode = body.status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: body.message }));
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, WEB_HOST, () => {
      server.removeListener("error", onError);
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolve({
        port: actual,
        host: WEB_HOST,
        close: () =>
          new Promise((done, fail) => {
            for (const socket of sockets) {
              socket.destroy();
            }
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
