export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, "offline", "Jarvis ist gerade nicht erreichbar.");
  }
  const raw = await response.text();
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    const record = body && typeof body === "object" ? (body as { error?: unknown }) : {};
    const error = record.error;
    if (error && typeof error === "object" && "message" in error) {
      const nested = error as { code?: string; message?: string };
      throw new ApiError(response.status, nested.code ?? "error", nested.message ?? "Fehler");
    }
    throw new ApiError(
      response.status,
      "error",
      typeof error === "string" ? error : "Die Anfrage ist fehlgeschlagen.",
    );
  }
  return body as T;
}
