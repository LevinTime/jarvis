export type SpeechResultRow = {
  isFinal: boolean;
  0?: { transcript?: string };
};

export type SpeechResultEvent = {
  results: ArrayLike<SpeechResultRow>;
};

export type SpeechErrorEvent = {
  error?: string;
};

export type SpeechSession = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

export type SpeechHost = {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
};

export function findSpeechRecognition(host: object): (new () => SpeechSession) | null {
  const record = host as SpeechHost;
  const ctor = record.SpeechRecognition ?? record.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as new () => SpeechSession) : null;
}

export function transcriptFrom(event: SpeechResultEvent): { text: string; final: boolean } {
  let text = "";
  let final = false;
  for (let index = 0; index < event.results.length; index += 1) {
    const row = event.results[index];
    if (!row) {
      continue;
    }
    text += row[0]?.transcript ?? "";
    if (row.isFinal) {
      final = true;
    }
  }
  return { text: text.replace(/\s+/g, " ").trim(), final };
}

/** Permission and engine failures should drop the mic. A quiet stop does not. */
export function speechFailure(error: string | undefined): boolean {
  return error !== undefined && error !== "aborted" && error !== "no-speech";
}
