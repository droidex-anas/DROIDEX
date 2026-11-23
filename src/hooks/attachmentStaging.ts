export function createPendingAdditions() {
  let generation = 0;
  const pending = new Set<Promise<unknown>>();
  return {
    stamp: () => generation,
    isStale: (stamped: number) => stamped !== generation,
    invalidate: () => {
      generation += 1;
    },
    track: (task: Promise<unknown>) => {
      pending.add(task);
      const done = () => {
        pending.delete(task);
      };
      void task.then(done, done);
    },

    settled: async (): Promise<void> => {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },

    knownSettled: async (): Promise<void> => {
      await Promise.allSettled([...pending]);
    },
  };
}

export type PendingAdditions = ReturnType<typeof createPendingAdditions>;

export function createCropMutations() {
  const pending = new Set<{ sequence: number; promise: Promise<unknown> }>();
  return {
    track(sequence: number, task: Promise<unknown>) {
      const entry = { sequence, promise: task };
      pending.add(entry);
      const done = () => {
        pending.delete(entry);
      };
      void task.then(done, done);
    },
    waitBeforeCutoff: async (cutoff: number): Promise<void> => {
      let inflight = [...pending].filter((crop) => crop.sequence < cutoff);
      while (inflight.length > 0) {
        await Promise.allSettled(inflight.map((crop) => crop.promise));
        inflight = [...pending].filter((crop) => crop.sequence < cutoff);
      }
    },
  };
}

export async function saveImageUnlessStale(
  additions: PendingAdditions,
  stamp: number,
  save: () => Promise<string>,
  discard: (path: string) => Promise<void>,
): Promise<string | null> {
  const path = await save();
  if (!additions.isStale(stamp)) return path;
  void discard(path);
  return null;
}

export function insertBySequence<T extends { id: string }>(
  items: T[],
  item: T,
  sequences: ReadonlyMap<string, number>,
): T[] {
  const order = (entry: T) => sequences.get(entry.id) ?? Number.MAX_SAFE_INTEGER;
  return [...items, item].sort((a, b) => order(a) - order(b));
}

export function itemsBeforeCutoff<T extends { id: string }>(
  items: readonly T[],
  sequences: ReadonlyMap<string, number>,
  cutoff: number,
): T[] {
  return items.filter((item) => (sequences.get(item.id) ?? Number.MAX_SAFE_INTEGER) < cutoff);
}

export function pathsInSequence(items: readonly { path: string; sequence: number }[]): string[] {
  return [...items].sort((a, b) => a.sequence - b.sequence).map((item) => item.path);
}
