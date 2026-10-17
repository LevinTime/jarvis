import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { Hono } from "hono";
import {
  TaskConflictError,
  TaskNotFoundError,
  TaskValidationError,
  type TaskService,
} from "../tasks/service.ts";
import { renderHomePage } from "./page.ts";

export const WEB_HOST = "127.0.0.1";

function errorBody(error: unknown): { status: 400 | 404 | 409 | 500; message: string } {
  if (error instanceof TaskValidationError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof TaskNotFoundError) {
    return { status: 404, message: error.message };
  }
  if (error instanceof TaskConflictError) {
    return { status: 409, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, message };
}

export function createWebApp(options: {
  reply: (message: string) => Promise<string>;
  tasks: Pick<TaskService, "list" | "run" | "reset">;
}): Hono {
  const app = new Hono();

  app.get("/", (c) => c.html(renderHomePage()));

  app.get("/api/tasks", async (c) => {
    try {
      const tasks = await options.tasks.list();
      return c.json({ tasks });
    } catch (error) {
      const body = errorBody(error);
      return c.json({ error: body.message }, body.status);
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

  app.post("/api/chat", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON ungültig" }, 400);
    }
    const message =
      payload && typeof payload === "object" && "message" in payload &&
      typeof payload.message === "string"
        ? payload.message.trim()
        : "";
    if (!message) {
      return c.json({ error: "message fehlt" }, 400);
    }
    try {
      const reply = await options.reply(message);
      return c.json({ reply });
    } catch (error) {
      const body = errorBody(error);
      return c.json({ error: body.message }, body.status);
    }
  });

  return app;
}

function requestFromNode(req: IncomingMessage, fallbackPort: number): Request {
  const host = req.headers.host ?? `${WEB_HOST}:${fallbackPort}`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const method = req.method ?? "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (hasBody) {
    init.body = Readable.toWeb(req) as ReadableStream;
    init.duplex = "half";
  }
  return new Request(url, init);
}

export function startWebServer(
  app: Hono,
  options: { port?: number } = {},
): Promise<{ port: number; host: string; close: () => Promise<void> }> {
  const port = options.port ?? 3000;
  const server = createServer(async (req, res) => {
    try {
      const response = await app.fetch(requestFromNode(req, port));
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      const body = errorBody(error);
      res.statusCode = body.status;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: body.message }));
    }
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
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
