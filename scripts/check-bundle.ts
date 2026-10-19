import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const TEXT_FILE = /\.(?:js|css|html|json|webmanifest|txt|map|svg|xml)$/i;

const RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: "xai-key", pattern: /xai-[A-Za-z0-9]{8,}/i },
  { name: "telegram-token", pattern: /\d{8,12}:[A-Za-z0-9_-]{30,}/ },
  { name: "sk-key", pattern: /sk-[A-Za-z0-9_-]{16,}/ },
];

async function walkText(root: string): Promise<Array<{ file: string; text: string }>> {
  const found: Array<{ file: string; text: string }> = [];
  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!TEXT_FILE.test(entry.name)) {
        continue;
      }
      found.push({ file: path.relative(root, full), text: await readFile(full, "utf8") });
    }
  }
  await visit(root);
  return found;
}

export async function findSecretHits(root: string): Promise<Array<{ file: string; rule: string }>> {
  const hits: Array<{ file: string; rule: string }> = [];
  for (const file of await walkText(root)) {
    for (const rule of RULES) {
      if (rule.pattern.test(file.text)) {
        hits.push({ file: file.file, rule: rule.name });
      }
    }
  }
  return hits;
}

export function secretEnvNames(envText: string): Array<{ name: string; value: string }> {
  const secrets: Array<{ name: string; value: string }> = [];
  for (const line of envText.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) {
      continue;
    }
    const name = match[1] ?? "";
    const value = (match[2] ?? "").trim();
    if (value.length < 12) {
      continue;
    }
    if (name === "GROK_API_KEY" || name === "TELEGRAM_BOT_TOKEN" || /SECRET|TOKEN|KEY/.test(name)) {
      secrets.push({ name, value });
    }
  }
  return secrets;
}

export async function findEnvLeaks(root: string, envText: string): Promise<string[]> {
  const files = await walkText(root);
  const joined = files.map((file) => file.text).join("\n");
  return secretEnvNames(envText)
    .filter((secret) => joined.includes(secret.value))
    .map((secret) => secret.name);
}
