export type TaskStatus = "offen" | "in Arbeit" | "erledigt" | "fehlgeschlagen";

export type Task = {
  id: string;
  titel: string;
  aufgabe: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  faelligAm?: string;
  wiederholung?: "taeglich" | "woechentlich" | null;
};

export type Note = {
  id: string;
  person?: string;
  text: string;
  erstelltAm: string;
  offen: boolean;
  erinnernAm?: string;
};

export type ChatMessage = {
  id: string;
  clientId?: string;
  ts: string;
  source: "telegram" | "web" | "system";
  role: "user" | "assistant";
  text: string;
  status?: "pending" | "done" | "error";
  error?: string;
};

export type BudgetLevel = "none" | "ok" | "warn" | "over";

export type Budget = {
  limitUsd: number | null;
  spentUsd: number;
  ratio: number | null;
  level: BudgetLevel;
};

export type UsageTotals = {
  costUsd: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  requests: number;
  errors: number;
};

export type UsageReport = {
  range: string;
  headline: UsageTotals;
  today: UsageTotals;
  last7d: UsageTotals;
  month: UsageTotals;
  last30d: UsageTotals;
  byDay: Array<UsageTotals & { date: string }>;
  bySource: Record<string, UsageTotals>;
  byPurpose: Record<string, UsageTotals>;
  budget: Budget;
  pricesAreEstimates: boolean;
};

export type StatusResponse = {
  telegram: { configured: boolean; connected: boolean; mirror: boolean; warning?: string };
  llm: { configured: boolean; lastError: string | null };
  uptimeSec: number;
  version: string;
  tasks: {
    open: number;
    overdue: number;
    today: number;
    upcoming: Array<{ id: string; titel: string; faelligAm?: string; status: string }>;
  };
  usage: {
    todayUsd: number;
    monthUsd: number;
    budget: Budget;
    pricesAreEstimates: boolean;
  } | null;
  notes: { open: number };
};

export type CalendarItem = {
  taskId: string;
  titel: string;
  aufgabe: string;
  status: TaskStatus;
  faelligAm: string;
  wiederholung?: "taeglich" | "woechentlich";
  projected: boolean;
};

export type JarvisEvent = {
  id: number;
  type: string;
  message?: ChatMessage;
  action?: string;
  taskId?: string;
  task?: Task;
  noteId?: string;
  note?: Note;
  telegramConnected?: boolean;
  llmConfigured?: boolean;
};
