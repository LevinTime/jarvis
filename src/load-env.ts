import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function loadEnv(): void {
  config({ path: path.join(projectRoot, ".env"), quiet: true });
}

export class MissingConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    const list = missing.join(", ");
    super(
      missing.length === 1
        ? `${list} fehlt in .env. Trag den Wert ein (Vorlage: config/.env.example).`
        : `Diese Werte fehlen in .env: ${list}. Vorlage: config/.env.example.`,
    );
    this.name = "MissingConfigError";
    this.missing = missing;
  }
}

export function requireEnv(
  names: string[],
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const missing = names.filter((name) => !(env[name]?.trim()));
  if (missing.length > 0) {
    throw new MissingConfigError(missing);
  }
  const values: Record<string, string> = {};
  for (const name of names) {
    values[name] = env[name]?.trim() ?? "";
  }
  return values;
}
