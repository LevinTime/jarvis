import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function loadEnv(): void {
  config({ path: path.join(projectRoot, ".env") });
}
