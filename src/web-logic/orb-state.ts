const ORB_STATES = ["idle", "listening", "thinking", "speaking", "error"] as const;

export type OrbState = (typeof ORB_STATES)[number];

export function isOrbState(value: string | null | undefined): value is OrbState {
  return ORB_STATES.includes(value as OrbState);
}

/** How long the orb stays in speaking after an assistant message arrives. */
export const SPEAK_FOR_MS = 2800;

export type OrbMessage = {
  id: string;
  role: string;
  status?: string;
  ts: string;
};

/**
 * Chat drives the orb. A pending user turn is thinking.
 * A fresh assistant message is speaking, then the orb returns to idle.
 * Listening only applies when speech input already exists and the caller sets the flag.
 * A failed turn, or failed: true, is error until a newer reply.
 */
function latestTs(messages: readonly OrbMessage[], match: (message: OrbMessage) => boolean): number {
  let latest = 0;
  for (const message of messages) {
    if (!match(message)) {
      continue;
    }
    const ts = Date.parse(message.ts);
    if (Number.isFinite(ts) && ts > latest) {
      latest = ts;
    }
  }
  return latest;
}

export function resolveOrbState(input: {
  messages: readonly OrbMessage[];
  now: number;
  speakForMs?: number;
  listening?: boolean;
  failed?: boolean;
}): OrbState {
  const pendingUser = input.messages.some((message) => message.role === "user" && message.status === "pending");
  if (pendingUser) {
    return "thinking";
  }
  if (input.listening) {
    return "listening";
  }
  const latestError = latestTs(input.messages, (message) => message.status === "error");
  const latest = latestTs(
    input.messages,
    (message) => message.role === "assistant" && message.status === "done",
  );
  if (input.failed || latestError > latest) {
    return "error";
  }
  const speakFor = input.speakForMs ?? SPEAK_FOR_MS;
  if (latest > 0 && input.now >= latest && input.now - latest < speakFor) {
    return "speaking";
  }
  return "idle";
}

/** Movement is paused in the background and dropped when the user prefers less motion. */
export function orbMoves(reducedMotion: boolean, hidden: boolean): boolean {
  return !reducedMotion && !hidden;
}
