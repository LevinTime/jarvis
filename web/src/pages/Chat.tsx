import { useEffect, useRef, useState } from "react";
import { api } from "../api.ts";
import { clock, dayLabel } from "../format.ts";
import type { ChatMessage } from "../types.ts";
import { useI18n } from "../i18n/index.ts";
import { Empty, Markdown, Sheet, Skeleton, pulse } from "../ui.tsx";

export function Chat({
  messages,
  loading,
  error,
  onSend,
  onOlder,
  onCorrected,
}: {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  onSend: (text: string) => Promise<void>;
  onOlder: (beforeId: string) => Promise<ChatMessage[]>;
  onCorrected: () => void;
}) {
  const t = useI18n();
  const [text, setText] = useState("");
  const [jump, setJump] = useState(false);
  const [older, setOlder] = useState(false);
  const [wrong, setWrong] = useState<ChatMessage | null>(null);
  const [note, setNote] = useState("");
  const [wrongError, setWrongError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const hold = useRef<number | null>(null);
  const typing = messages.some((message) => message.role === "user" && message.status === "pending");

  useEffect(() => {
    const el = logRef.current;
    if (!el || !stick.current) {
      setJump(true);
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  async function send() {
    const value = text.trim();
    if (!value) {
      return;
    }
    setText("");
    stick.current = true;
    pulse();
    await onSend(value);
  }

  function clearHold() {
    if (hold.current) {
      window.clearTimeout(hold.current);
      hold.current = null;
    }
  }

  function openWrong(message: ChatMessage) {
    setWrong(message);
    setNote("");
    setWrongError(null);
    setSaved(false);
  }

  async function saveWrong() {
    if (!wrong) {
      return;
    }
    setWrongError(null);
    try {
      await api("/api/corrections", {
        method: "POST",
        body: JSON.stringify({ messageId: wrong.id, korrektur: note.trim() }),
      });
      setWrong(null);
      setNote("");
      setSaved(true);
      onCorrected();
    } catch (reason) {
      setWrongError(reason instanceof Error ? reason.message : t("memory.fail"));
    }
  }

  async function loadOlder() {
    const el = logRef.current;
    const oldest = messages[0];
    if (!el || !oldest || older) {
      return;
    }
    setOlder(true);
    const before = el.scrollHeight;
    try {
      const page = await onOlder(oldest.id);
      if (page.length === 0) {
        return;
      }
      requestAnimationFrame(() => {
        if (logRef.current) {
          logRef.current.scrollTop += logRef.current.scrollHeight - before;
        }
      });
    } finally {
      setOlder(false);
    }
  }

  let lastDay = "";
  return (
    <div className="chat-slide" style={{ height: "100%" }}>
      <header className="top">
        <div>
          <p className="eyebrow">{t("chat.kicker")}</p>
          <h1>{t("chat.title")}</h1>
        </div>
      </header>
      {error ? <div className="banner bad" role="alert">{error}</div> : null}
      {saved ? <div className="banner">{t("memory.saved")}</div> : null}
      <div
        className="chat-log"
        ref={logRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          stick.current = distance < 96;
          setJump(!stick.current);
          if (el.scrollTop < 48) {
            void loadOlder();
          }
        }}
      >
        {loading && messages.length === 0 ? <Skeleton lines={4} /> : null}
        {!loading && messages.length === 0 ? (
          <Empty title={t("chat.emptyTitle")} text={t("chat.emptyBody")} />
        ) : null}
        {messages.map((message) => {
          const day = dayLabel(message.ts);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = message.role === "user";
          return (
            <div key={message.id} className="stack">
              {showDay ? <div className="day-chip">{day}</div> : null}
              <article
                className={`bubble ${message.source === "system" ? "system" : mine ? "user" : "assistant"}`}
                {...(mine ? {} : { "data-no-swipe": true })}
                onPointerDown={() => {
                  if (mine) {
                    return;
                  }
                  clearHold();
                  hold.current = window.setTimeout(() => openWrong(message), 480);
                }}
                onPointerMove={clearHold}
                onPointerUp={clearHold}
                onPointerCancel={clearHold}
                onContextMenu={(event) => {
                  if (mine) {
                    return;
                  }
                  event.preventDefault();
                  openWrong(message);
                }}
              >
                <div className="meta">
                  <span>{message.source === "telegram" ? t("source.telegram") : message.source === "web" ? t("source.web") : t("source.system")}</span>
                  <time dateTime={message.ts}>{clock(message.ts)}</time>
                </div>
                <Markdown text={message.text} />
                {message.status === "error" ? (
                  <p>
                    {message.error ?? t("chat.fail")}{" "}
                    <button type="button" className="text-btn ghost" onClick={() => void onSend(message.text)}>
                      {t("chat.retry")}
                    </button>
                  </p>
                ) : null}
              </article>
            </div>
          );
        })}
        {typing ? <div className="bubble assistant" aria-live="polite">{t("chat.typing")}</div> : null}
        {jump ? (
          <button
            type="button"
            className="text-btn jump"
            onClick={() => {
              stick.current = true;
              const el = logRef.current;
              if (el) {
                el.scrollTop = el.scrollHeight;
              }
              setJump(false);
            }}
          >
            {t("chat.jump")}
          </button>
        ) : null}
      </div>
      <form
        className="composer"
        data-no-swipe
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="chat-text">{t("chat.message")}</label>
        <textarea
          id="chat-text"
          rows={1}
          value={text}
          maxLength={4000}
          placeholder={t("chat.placeholder")}
          enterKeyHint="send"
          onChange={(event) => {
            setText(event.target.value);
            event.target.style.height = "auto";
            event.target.style.height = `${Math.min(event.target.scrollHeight, 136)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) {
              return;
            }
            if (window.matchMedia("(pointer: coarse)").matches) {
              return;
            }
            event.preventDefault();
            void send();
          }}
        />
        <button type="submit" className="send" aria-label={t("chat.send")}>{t("chat.send")}</button>
      </form>
      <Sheet open={wrong !== null} title={t("memory.wrong")} onClose={() => setWrong(null)}>
        <label className="field">
          <span>{t("memory.wrongHint")}</span>
          <textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
        </label>
        {wrongError ? <p role="alert">{wrongError}</p> : null}
        <button type="button" className="text-btn" onClick={() => void saveWrong()}>{t("common.save")}</button>
      </Sheet>
    </div>
  );
}
