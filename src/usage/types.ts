export type UsageSource = "telegram" | "web" | "cli" | "cron" | "system";

export type UsagePurpose = "chat" | "translate" | "tool" | "summary" | "memory" | "selfcheck";

export type UsageEntry = {
  ts: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  source: UsageSource;
  purpose: UsagePurpose;
  ok: boolean;
  error?: string;
};

export type UsageDraft = Omit<UsageEntry, "ts"> & { ts?: string };

export type UsageNotice = Omit<UsageEntry, "ts">;
