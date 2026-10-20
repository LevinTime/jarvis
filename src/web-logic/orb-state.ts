export type OrbState = "idle" | "listening" | "thinking" | "speaking";

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
 */
export function resolveOrbState(input: {
  messages: readonly OrbMessage[];
  now: number;
  speakForMs?: number;
  listening?: boolean;
}): OrbState {
  const pendingUser = input.messages.some((message) => message.role === "user" && message.status === "pending");
  if (pendingUser) {
    return "thinking";
  }
  if (input.listening) {
    return "listening";
  }
  const speakFor = input.speakForMs ?? SPEAK_FOR_MS;
  let latest = 0;
  for (const message of input.messages) {
    if (message.role !== "assistant" || message.status !== "done") {
      continue;
    }
    const ts = Date.parse(message.ts);
    if (Number.isFinite(ts) && ts > latest) {
      latest = ts;
    }
  }
  if (latest > 0 && input.now >= latest && input.now - latest < speakFor) {
    return "speaking";
  }
  return "idle";
}

/** Movement is paused in the background and dropped when the user prefers less motion. */
export function orbMoves(reducedMotion: boolean, hidden: boolean): boolean {
  return !reducedMotion && !hidden;
}
