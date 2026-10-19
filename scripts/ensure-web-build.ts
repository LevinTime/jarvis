import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../src/load-env.ts";

async function newest(dir: string): Promise<number> {
  let max = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name === "dist" || entry.name === "node_modules") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      max = Math.max(max, await newest(full));
      continue;
    }
    max = Math.max(max, (await stat(full)).mtimeMs);
  }
  return max;
}

const distIndex = path.join(projectRoot, "web", "dist", "index.html");
let built = 0;
try {
  built = (await stat(distIndex)).mtimeMs;
} catch {
  built = 0;
}
const sources = Math.max(
  await newest(path.join(projectRoot, "web")),
  await newest(path.join(projectRoot, "src", "web-logic")),
);
if (built !== 0 && sources <= built) {
  process.exit(0);
}
const result = spawnSync("npx", ["vite", "build", "--config", "web/vite.config.ts"], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
