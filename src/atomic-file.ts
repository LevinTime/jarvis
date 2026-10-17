import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

export async function writeTextAtomic(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(tmp, contents, "utf8");
    await replaceFile(tmp, filePath);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

async function replaceFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    const code = errorCode(error);
    if (code === "EEXIST" || code === "EPERM" || code === "EACCES") {
      await unlink(to);
      await rename(from, to);
      return;
    }
    throw error;
  }
}

export async function readText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (!isEnoent(error)) {
      throw error;
    }
    const pending = await hasPendingTemp(filePath);
    if (!pending) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    return readFile(filePath, "utf8");
  }
}

async function hasPendingTemp(filePath: string): Promise<boolean> {
  const dir = path.dirname(filePath);
  const prefix = `.${path.basename(filePath)}.`;
  try {
    const names = await readdir(dir);
    return names.some((name) => name.startsWith(prefix) && name.endsWith(".tmp"));
  } catch (error) {
    if (isEnoent(error)) {
      return false;
    }
    throw error;
  }
}

export function parseJson(raw: string, label: string): unknown {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} ist kein gültiges JSON`);
  }
}
