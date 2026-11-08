import { useEffect, useRef, useState } from "react";
import { findSpeechRecognition, speechFailure, transcriptFrom, type SpeechSession } from "@jarvis/speech.ts";
import type { LocaleId } from "./i18n/index.ts";

export function useDictation(locale: LocaleId) {
  const supported = findSpeechRecognition(window) !== null;
  const [listening, setListening] = useState(false);
  const [failed, setFailed] = useState(false);
  const session = useRef<SpeechSession | null>(null);

  useEffect(() => () => {
    session.current?.abort();
  }, []);

  function stop() {
    session.current?.stop();
    setListening(false);
  }

  function start(onText: (text: string) => void): boolean {
    const Ctor = findSpeechRecognition(window);
    if (!Ctor) {
      setFailed(true);
      return false;
    }
    session.current?.abort();
    const next = new Ctor();
    next.lang = locale === "en" ? "en-GB" : "de-DE";
    next.interimResults = true;
    next.continuous = false;
    next.onresult = (event) => {
      const heard = transcriptFrom(event);
      if (heard.text) {
        onText(heard.text);
      }
    };
    next.onerror = (event) => {
      if (speechFailure(event.error)) {
        setFailed(true);
      }
      setListening(false);
    };
    next.onend = () => setListening(false);
    session.current = next;
    try {
      next.start();
      setListening(true);
      setFailed(false);
      return true;
    } catch {
      setListening(false);
      setFailed(true);
      return false;
    }
  }

  return { supported: supported && !failed, listening, start, stop };
}
