export type LlmFailure = {
  code: string;
  message: string;
};

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function readName(error: unknown): string {
  if (!error || typeof error !== "object" || !("name" in error)) {
    return "";
  }
  return String((error as { name?: unknown }).name ?? "");
}

function readMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

export function isLlmTimeout(error: unknown): boolean {
  const name = readName(error);
  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    name === "APIConnectionTimeoutError"
  ) {
    return true;
  }
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "ETIMEDOUT") {
    return true;
  }
  const message = readMessage(error);
  return message.includes("timeout") || message.includes("timed out");
}

export function isLlmNetwork(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ECONNRESET") {
    return true;
  }
  const name = readName(error);
  if (name === "APIConnectionError" || name === "FetchError") {
    return true;
  }
  const message = readMessage(error);
  return message.includes("fetch failed") || message.includes("network");
}

export function germanLlmError(error: unknown): LlmFailure {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "missing_key") {
    return {
      code: "llm_unconfigured",
      message: "GROK_API_KEY fehlt in .env. Trag den Wert ein (Vorlage: config/.env.example).",
    };
  }
  const status = readStatus(error);
  if (status === 403) {
    return {
      code: "llm_forbidden",
      message:
        "xAI lehnt die Anfrage ab (403). Vermutlich fehlt Guthaben oder der API-Key stimmt nicht.",
    };
  }
  if (status === 429) {
    return {
      code: "llm_rate_limit",
      message: "Zu viele Anfragen beim Sprachmodell (429). Kurz warten und erneut senden.",
    };
  }
  if (isLlmTimeout(error)) {
    return {
      code: "llm_timeout",
      message: "Die Antwort hat zu lange gedauert und wurde abgebrochen.",
    };
  }
  if (isLlmNetwork(error)) {
    return {
      code: "llm_network",
      message: "Das Sprachmodell ist gerade nicht erreichbar.",
    };
  }
  return {
    code: "llm_error",
    message: "Das Sprachmodell hat einen Fehler gemeldet. Versuch es noch einmal.",
  };
}
