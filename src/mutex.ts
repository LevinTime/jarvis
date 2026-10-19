export function createMutex() {
  let chain = Promise.resolve();

  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function drain(): Promise<void> {
    return chain.then(() => undefined);
  }

  return { exclusive, drain };
}

export type Mutex = ReturnType<typeof createMutex>;
