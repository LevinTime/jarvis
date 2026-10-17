import {
  chatWithTools,
  createBotTools,
  type LlmClient,
} from "./bot/tools.ts";
import type { NoteService } from "./notes/service.ts";
import type { TaskService } from "./tasks/service.ts";
import type { TranscriptService } from "./transcripts/service.ts";

export type Assistant = {
  reply(userText: string): Promise<string>;
};

export function createAssistant(options: {
  llm: LlmClient;
  systemPrompt: string;
  tasks: TaskService;
  transcripts: TranscriptService;
  notes?: NoteService;
  timeZone?: string;
  now?: () => Date;
}): Assistant {
  const tools = createBotTools(options.tasks, options.transcripts, options.notes);
  return {
    reply(userText: string) {
      return chatWithTools({
        llm: options.llm,
        systemPrompt: options.systemPrompt,
        userText,
        tools: tools.definitions,
        execute: tools.execute,
        timeZone: options.timeZone,
        now: options.now?.(),
      });
    },
  };
}
