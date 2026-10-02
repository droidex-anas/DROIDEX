function withGlobalStorage(storage: Storage, fn: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  try {
    fn();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

/** Runs `fn` against an in-memory localStorage; pass a Map to inspect what it wrote. */
export function withLocalStorageMap(
  seed: Record<string, string> | Map<string, string>,
  fn: () => void,
): void {
  const values = seed instanceof Map ? seed : new Map(Object.entries(seed));
  const mock: Storage = {
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
  withGlobalStorage(mock, fn);
}

/** Runs `fn` against a localStorage whose reads and writes throw, as a denied or full store does. */
export function withFailingLocalStorage(fn: () => void): void {
  const fail = () => {
    throw new Error('storage denied');
  };
  withGlobalStorage({ getItem: fail, setItem: fail } as unknown as Storage, fn);
}
