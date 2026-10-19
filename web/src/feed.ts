import { useEffect, useRef, useState } from "react";
import { createLiveState, reconnectDelayMs, type ConnectionState } from "@jarvis/live.ts";
import { parseSseBlock } from "@jarvis/sse.ts";
import type { JarvisEvent } from "./types.ts";

export function useLiveFeed(
  onEvent: (event: JarvisEvent) => void,
  onResync: () => void,
): ConnectionState {
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const onEventRef = useRef(onEvent);
  const onResyncRef = useRef(onResync);
  onEventRef.current = onEvent;
  onResyncRef.current = onResync;

  useEffect(() => {
    const store = createLiveState();
    const unsub = store.subscribe(() => setConnection(store.get().connection));
    const ctrl = new AbortController();
    let stopped = false;
    let attempt = 0;
    const nudge = { fn: () => undefined };
    async function run(): Promise<void> {
      while (!stopped) {
        store.setConnection("connecting");
        try {
          const response = await fetch("/api/events", {
            headers: { "last-event-id": String(store.get().lastEventId) },
            signal: ctrl.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(String(response.status));
          }
          store.setConnection("connected");
          attempt = 0;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";
            for (const frame of frames) {
              const block = parseSseBlock(frame);
              if (!block) {
                continue;
              }
              if (block.id !== undefined) {
                store.seen(block.id);
              }
              if (block.event === "resync") {
                store.requestResync();
                onResyncRef.current();
                continue;
              }
              if (!block.data) {
                continue;
              }
              try {
                onEventRef.current(JSON.parse(block.data) as JarvisEvent);
              } catch {
                /* a bad frame must not kill the stream */
              }
            }
          }
        } catch {
          if (stopped) {
            return;
          }
          store.setConnection("offline");
          const delay = reconnectDelayMs(attempt);
          attempt += 1;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, delay);
            nudge.fn = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
      }
    }
    void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        nudge.fn();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      ctrl.abort();
      document.removeEventListener("visibilitychange", onVisible);
      unsub();
    };
  }, []);

  return connection;
}
