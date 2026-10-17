import { writeSync } from "node:fs";

export function formatLogLine(message: string, now = new Date()): string {
  return `${now.toISOString()} ${message}`;
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
