import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { projectRoot } from "./load-env.ts";
import type { LlmClient, LlmMessage, LlmResult, ToolCall } from "./bot/tools.ts";

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

export function createGrokClient(options: {
  apiKey: string;
  model?: string;
  baseURL?: string;
}): LlmClient {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL ?? "https://api.x.ai/v1",
  });
  const model = options.model?.trim() || "grok-4";

  return {
    async complete({ messages, tools }): Promise<LlmResult> {
      const response = await client.chat.completions.create({
        model,
        messages: toOpenAIMessages(messages),
        ...(tools.length > 0 ? { tools } : {}),
      });
      const message = response.choices[0]?.message;
      return {
        content: message?.content ?? null,
        tool_calls: parseToolCalls(message?.tool_calls),
      };
    },
  };
}
