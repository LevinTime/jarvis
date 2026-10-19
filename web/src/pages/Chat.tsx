import { useEffect, useRef, useState } from "react";
import { clock, dayLabel } from "../format.ts";
import type { ChatMessage } from "../types.ts";
import { Empty, Markdown, Skeleton, pulse } from "../ui.tsx";

export function Chat({
  messages,
  loading,
  error,
  onSend,
  onOlder,
}: {
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  onSend: (text: string) => Promise<void>;
  onOlder: (beforeId: string) => Promise<ChatMessage[]>;
}) {
  const [text, setText] = useState("");
  const [jump, setJump] = useState(false);
  const [older, setOlder] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
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
          <p className="eyebrow">Chat</p>
          <h1>Jarvis</h1>
        </div>
      </header>
      {error ? <div className="banner bad" role="alert">{error}</div> : null}
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
          <Empty title="Noch nichts gesagt" text="Schreib Jarvis, was ansteht. Telegram und die App teilen sich den Verlauf." />
        ) : null}
        {messages.map((message) => {
          const day = dayLabel(message.ts);
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = message.role === "user";
          return (
            <div key={message.id} className="stack">
              {showDay ? <div className="day-chip">{day}</div> : null}
              <article className={`bubble ${message.source === "system" ? "system" : mine ? "user" : "assistant"}`}>
                <div className="meta">
                  <span>{message.source === "telegram" ? "Telegram" : message.source === "web" ? "Web" : "System"}</span>
                  <time dateTime={message.ts}>{clock(message.ts)}</time>
                </div>
                <Markdown text={message.text} />
                {message.status === "error" ? (
                  <p>
                    {message.error ?? "Nicht gesendet."}{" "}
                    <button type="button" className="text-btn ghost" onClick={() => void onSend(message.text)}>
                      Erneut senden
                    </button>
                  </p>
                ) : null}
              </article>
            </div>
          );
        })}
        {typing ? <div className="bubble assistant" aria-live="polite">Jarvis tippt…</div> : null}
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
            Neue Nachrichten
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
        <label className="sr-only" htmlFor="chat-text">Nachricht</label>
        <textarea
          id="chat-text"
          rows={1}
          value={text}
          maxLength={4000}
          placeholder="Nachricht an Jarvis"
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
        <button type="submit" className="send" aria-label="Senden">Senden</button>
      </form>
    </div>
  );
}
