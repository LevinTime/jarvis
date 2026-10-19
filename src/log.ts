import { writeSync } from "node:fs";

export function redactSecrets(message: string): string {
  return message
    .replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, "<token>")
    .replace(/xai-[A-Za-z0-9_-]+/gi, "xai-<redacted>")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-<redacted>");
}

export function formatLogLine(message: string, now = new Date()): string {
  return `${now.toISOString()} ${redactSecrets(message)}`;
}

export function logInfo(message: string): void {
  console.log(formatLogLine(message));
}

export function logError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error
      ? `: ${error.message}`
      : error === undefined
        ? ""
        : `: ${String(error)}`;
  console.error(formatLogLine(`${message}${detail}`));
}

export function logErrorSync(message: string): void {
  writeSync(2, `${formatLogLine(message)}\n`);
}
