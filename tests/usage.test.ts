import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createGrokClient } from "../src/llm.ts";
import { MODEL_PRICES, resetPriceWarnings } from "../src/usage/prices.ts";
import { aggregateUsage, budgetLevel, costUsd } from "../src/usage/cost.ts";
import { createUsageStore } from "../src/usage/store.ts";
import type { UsageEntry } from "../src/usage/types.ts";

function entry(overrides: Partial<UsageEntry> & Pick<UsageEntry, "ts" | "model">): UsageEntry {
  return {
    promptTokens: 0,
    completionTokens: 0,
    source: "web",
    purpose: "chat",
    ok: true,
    ...overrides,
  };
}

test("cost uses the price table and unknown models stay at zero", () => {
  resetPriceWarnings();
  const price = MODEL_PRICES["grok-4"];
  assert.ok(price);
  assert.equal(
    costUsd({ model: "grok-4", promptTokens: 1_000_000, completionTokens: 2_000_000, ok: true }),
    price.input + price.output * 2,
  );
  assert.equal(
    costUsd({ model: "kein-modell", promptTokens: 5000, completionTokens: 5000, ok: true }),
    0,
  );
  assert.equal(
    costUsd({ model: "grok-4", promptTokens: 999, completionTokens: 999, ok: false }),
    0,
  );
});

test("budget levels warn at 80 percent and over at 100", () => {
  assert.equal(budgetLevel(0, null), "none");
  assert.equal(budgetLevel(7, 10), "ok");
  assert.equal(budgetLevel(8, 10), "warn");
  assert.equal(budgetLevel(10, 10), "over");
});

test("aggregation keeps Berlin days, sources and failed calls out of the cost", () => {
  const now = new Date("2026-11-01T09:00:00+01:00");
  const report = aggregateUsage({
    now,
    timeZone: "Europe/Berlin",
    budgetUsd: 1,
    range: "month",
    entries: [
      entry({
        ts: "2026-10-31T22:30:00.000Z",
        model: "grok-4",
        promptTokens: 1_000_000,
        completionTokens: 0,
        source: "telegram",
        purpose: "chat",
      }),
      entry({
        ts: "2026-11-01T00:30:00+01:00",
        model: "grok-4",
        promptTokens: 0,
        completionTokens: 1_000_000,
        source: "web",
        purpose: "tool",
      }),
      entry({
        ts: "2026-11-01T08:00:00+01:00",
        model: "grok-4",
        promptTokens: 100,
        completionTokens: 100,
        ok: false,
        error: "llm_forbidden",
        source: "web",
        purpose: "chat",
      }),
    ],
  });
  assert.equal(report.month.errors, 1);
  assert.equal(report.month.requests, 2);
  assert.equal(report.today.costUsd, MODEL_PRICES["grok-4"]?.output);
  assert.equal(report.month.costUsd, MODEL_PRICES["grok-4"]?.output);
  assert.equal(report.bySource.web?.errors, 1);
  assert.equal(report.byPurpose.tool?.completionTokens, 1_000_000);
  assert.equal(report.budget.level, "over");
  assert.equal(report.byDay.at(-1)?.date, "2026-11-01");
  assert.equal(report.pricesAreEstimates, true);
});

test("the usage store appends calls and ignores failed token counts", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "jarvis-usage-"));
  try {
    const store = createUsageStore({
      dataDir,
      budgetUsd: 10,
      now: () => new Date("2026-10-19T12:00:00+02:00"),
    });
    await store.append({
      model: "grok-4",
      promptTokens: 1000,
      completionTokens: 1000,
      cachedTokens: 10,
      source: "web",
      purpose: "chat",
      ok: true,
    });
    await store.append({
      model: "grok-4",
      promptTokens: 8000,
      completionTokens: 8000,
      source: "web",
      purpose: "chat",
      ok: false,
      error: "llm_forbidden",
    });
    const report = await store.report("today");
    assert.equal(report.today.requests, 2);
    assert.equal(report.today.errors, 1);
    assert.equal(report.today.promptTokens, 1000);
    assert.ok(report.today.costUsd > 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("createGrokClient records usage from a mocked response and from a 403", async () => {
  const seen: Array<{ ok: boolean; promptTokens: number; cachedTokens?: number; error?: string }> = [];
  const ok = createGrokClient({
    apiKey: "test-key",
    fetch: async () =>
      new Response(
        JSON.stringify({
          id: "1",
          object: "chat.completion",
          created: 0,
          model: "grok-4",
          choices: [{ index: 0, message: { role: "assistant", content: "Hallo" }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 5,
            prompt_tokens_details: { cached_tokens: 4 },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    onUsage: (notice) => {
      seen.push(notice);
    },
  });
  const result = await ok.complete({
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    purpose: "chat",
    source: "web",
  });
  assert.equal(result.content, "Hallo");
  assert.equal(seen[0]?.ok, true);
  assert.equal(seen[0]?.promptTokens, 20);
  assert.equal(seen[0]?.cachedTokens, 4);

  const denied = createGrokClient({
    apiKey: "test-key",
    fetch: async () =>
      new Response(JSON.stringify({ error: { message: "no credits", type: "insufficient_quota" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    onUsage: (notice) => {
      seen.push(notice);
    },
  });
  await assert.rejects(() =>
    denied.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      purpose: "chat",
      source: "telegram",
    }),
  );
  assert.equal(seen.at(-1)?.ok, false);
  assert.equal(seen.at(-1)?.error, "llm_forbidden");
  assert.equal(seen.at(-1)?.promptTokens, 0);
});
