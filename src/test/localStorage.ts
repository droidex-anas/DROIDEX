function installGlobalStorage(storage: Storage): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  };
}

function withGlobalStorage(storage: Storage, fn: () => void): void {
  const restore = installGlobalStorage(storage);
  try {
    fn();
  } finally {
    restore();
  }
}

/** Runs `fn` against an in-memory localStorage; pass a Map to inspect what it wrote. */
export function withLocalStorageMap(
  seed: Record<string, string> | Map<string, string>,
  fn: () => void,
): void {
  withGlobalStorage(memoryStorage(seed), fn);
}

/** Like withLocalStorageMap, but keeps the storage until `fn` settles, as a fresh module import needs. */
export async function withLocalStorageMapAsync(
  seed: Record<string, string> | Map<string, string>,
  fn: () => Promise<void>,
): Promise<void> {
  const restore = installGlobalStorage(memoryStorage(seed));
  try {
    await fn();
  } finally {
    restore();
  }
}

function memoryStorage(seed: Record<string, string> | Map<string, string>): Storage {
  const values = seed instanceof Map ? seed : new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, next) => {
      values.set(key, next);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
}

/** Runs `fn` against a localStorage whose reads and writes throw, as a denied or full store does. */
export function withFailingLocalStorage(fn: () => void): void {
  const fail = () => {
    throw new Error('storage denied');
  };
  withGlobalStorage(
    {
      getItem: fail,
      setItem: fail,
      removeItem: fail,
      clear: fail,
      key: fail,
      get length() {
        return fail();
      },
    },
    fn,
  );
}
