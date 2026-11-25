import { useCallback, useRef, useState } from 'react';
import { createPendingAdditions, insertBySequence, itemsBeforeCutoff } from './attachmentStaging';

export function useStagedAttachments<T extends { id: string; path: string }>(
  discard: (path: string) => Promise<void>,
) {
  const [items, setItems] = useState<T[]>([]);
  const itemsRef = useRef(items);
  const sequencesRef = useRef(new Map<string, number>());
  const nextSeqRef = useRef(0);
  const [additions] = useState(createPendingAdditions);

  // Keep commit, clear and clearAndDiscard stable: PromptInput effects depend on them.
  const commit = useCallback((next: T[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const reserveSequence = (sequence?: number) => {
    const reserved = sequence ?? nextSeqRef.current;
    if (sequence === undefined || sequence >= nextSeqRef.current) nextSeqRef.current = reserved + 1;
    return reserved;
  };

  const insert = (item: T, sequence: number) => {
    sequencesRef.current.set(item.id, sequence);
    commit(insertBySequence(itemsRef.current, item, sequencesRef.current));
  };

  const remove = (id: string) => {
    const hit = itemsRef.current.find((item) => item.id === id);
    if (!hit) return;
    sequencesRef.current.delete(id);
    commit(itemsRef.current.filter((item) => item.id !== id));
    // Discard outside state updaters so StrictMode fires it only once.
    void discard(hit.path);
  };

  // Submitted files belong to the prompt; only discard-clears delete them.
  const clear = useCallback(() => {
    additions.invalidate();
    sequencesRef.current.clear();
    commit([]);
  }, [additions, commit]);

  // Non-submit clears delete files that no prompt references.
  const clearAndDiscard = useCallback(() => {
    for (const item of itemsRef.current) void discard(item.path);
    clear();
  }, [clear, discard]);

  const whenReady = async (
    cutoff: number,
    waitForMutations?: (cutoff: number) => Promise<void>,
  ): Promise<T[]> => {
    await additions.knownSettled();
    if (waitForMutations) await waitForMutations(cutoff);
    return itemsBeforeCutoff(itemsRef.current, sequencesRef.current, cutoff);
  };

  const clearReady = (cutoff: number) => {
    const ready = new Set(itemsBeforeCutoff(itemsRef.current, sequencesRef.current, cutoff));
    for (const item of ready) sequencesRef.current.delete(item.id);
    commit(itemsRef.current.filter((item) => !ready.has(item)));
  };

  return {
    items,
    itemsRef,
    additions,
    commit,
    reserveSequence,
    insert,
    remove,
    clear,
    clearAndDiscard,
    whenReady,
    clearReady,
  };
}
