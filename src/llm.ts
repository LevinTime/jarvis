import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { LlmClient, LlmMessage, LlmResult, ToolCall } from "./bot/tools.ts";
import { germanLlmError } from "./llm-error.ts";
import { projectRoot } from "./load-env.ts";
import { logError } from "./log.ts";
import type { UsageNotice } from "./usage/types.ts";

export async function loadSystemPrompt(): Promise<string> {
  return readFile(path.join(projectRoot, "prompts", "system.md"), "utf8");
}

function toOpenAIMessages(messages: LlmMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.tool_call_id,
        content: message.content,
      };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
        ...(message.tool_calls && message.tool_calls.length > 0
          ? {
              tool_calls: message.tool_calls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments),
                },
              })),
            }
          : {}),
      };
    }
    return {
      role: message.role,
      content: message.content,
    };
  });
}

function parseToolCalls(
  raw: OpenAI.Chat.ChatCompletionMessage["tool_calls"],
): ToolCall[] | undefined {
  if (!raw || raw.length === 0) {
    return undefined;
  }
  const calls: ToolCall[] = [];
  for (const call of raw) {
    if (call.type !== "function") {
      continue;
    }
    let parsed: Record<string, unknown> = {};
    try {
      const value: unknown = JSON.parse(call.function.arguments || "{}");
      if (value && typeof value === "object" && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>;
      }
    } catch {
      parsed = {};
    }
    calls.push({
      id: call.id,
      name: call.function.name,
      arguments: parsed,
    });
  }
  return calls.length > 0 ? calls : undefined;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readTokenUsage(usage: unknown): {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
} {
  if (!usage || typeof usage !== "object") {
    return { promptTokens: 0, completionTokens: 0 };
  }
  const record = usage as Record<string, unknown>;
  const details = record.prompt_tokens_details;
  const cached =
    details && typeof details === "object"
      ? readCount((details as { cached_tokens?: unknown }).cached_tokens)
      : 0;
  return {
    promptTokens: readCount(record.prompt_tokens),
    completionTokens: readCount(record.completion_tokens),
    ...(cached > 0 ? { cachedTokens: cached } : {}),
  };
}

export function createGrokClient(options: {
  apiKey: string;
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  onUsage?: (notice: UsageNotice) => void | Promise<void>;
}): LlmClient {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL ?? "https://api.x.ai/v1",
    timeout: options.timeoutMs ?? 60_000,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const model = options.model?.trim() || "grok-4";

  async function notify(notice: UsageNotice): Promise<void> {
    if (!options.onUsage) {
      return;
    }
    try {
      await options.onUsage(notice);
    } catch (error) {
      logError("Usage nicht gespeichert", error);
    }
  }

  return {
    async complete({ messages, tools, purpose, source }): Promise<LlmResult> {
      const meta = {
        model,
        source: source ?? "web",
        purpose: purpose ?? "chat",
      } as const;
      try {
        const response = await client.chat.completions.create(
          {
            model,
            messages: toOpenAIMessages(messages),
            ...(tools.length > 0 ? { tools } : {}),
          },
          { timeout: options.timeoutMs ?? 60_000 },
        );
        const tokens = readTokenUsage(response.usage);
        await notify({ ...meta, ...tokens, ok: true });
        const message = response.choices[0]?.message;
        return {
          content: message?.content ?? null,
          tool_calls: parseToolCalls(message?.tool_calls),
        };
      } catch (error) {
        const failure = germanLlmError(error);
        await notify({
          ...meta,
          promptTokens: 0,
          completionTokens: 0,
          ok: false,
          error: failure.code,
        });
        throw error;
      }
    },
  };
}
