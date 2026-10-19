import type { LlmClient } from "../bot/tools.ts";
import type { UsageSource } from "../usage/types.ts";
import { applySelfCheck } from "./model.ts";

export async function runSelfCheck(options: {
  llm: LlmClient;
  question: string;
  answer: string;
  context: string;
  source?: UsageSource;
}): Promise<string> {
  const result = await options.llm.complete({
    messages: [
      {
        role: "system",
        content:
          "Du prüfst eine Antwort gegen die Fakten. Antworte nur mit ok oder mit der korrigierten Antwort. Erfinde nichts.",
      },
      {
        role: "user",
        content: `${options.context}\n\nFrage: ${options.question}\nAntwort: ${options.answer}`,
      },
    ],
    tools: [],
    purpose: "selfcheck",
    source: options.source,
    maxTokens: 150,
    reasoningEffort: "none",
  });
  return applySelfCheck(options.answer, result.content ?? "");
}
