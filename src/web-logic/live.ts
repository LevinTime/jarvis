export type ConnectionState = "offline" | "connecting" | "connected";

export type LiveState = {
  connection: ConnectionState;
  lastEventId: number;
  resync: boolean;
};

export function createLiveState(
  initial: LiveState = { connection: "connecting", lastEventId: 0, resync: false },
) {
  let state = initial;
  const listeners = new Set<() => void>();

  function set(next: LiveState): void {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    get(): LiveState {
      return state;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setConnection(connection: ConnectionState): void {
      if (state.connection === connection) {
        return;
      }
      set({ ...state, connection });
    },
    seen(id: number): void {
      if (!Number.isFinite(id) || id <= state.lastEventId) {
        return;
      }
      set({ ...state, lastEventId: id });
    },
    requestResync(): void {
      if (state.resync) {
        return;
      }
      set({ ...state, resync: true });
    },
    clearResync(): void {
      if (!state.resync) {
        return;
      }
      set({ ...state, resync: false });
    },
  };
}

export type LiveStore = ReturnType<typeof createLiveState>;

/** 1s, 2s, 4s … capped at 30s. */
export function reconnectDelayMs(attempt: number): number {
  const step = Math.min(5, Math.max(0, Math.floor(attempt)));
  return Math.min(30_000, 1000 * 2 ** step);
}
