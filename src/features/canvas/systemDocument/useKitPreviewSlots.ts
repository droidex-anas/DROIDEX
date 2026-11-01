// Which of a document's previews hold one of the four live slots it shares with
// the board (spec §7): the board's own reducer, fed with the tiles inside the
// document column, nearest its centre first. The others show their capture.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { NO_PREVIEW_SLOTS, reducePreviewSlots } from '../previewSlots';
import type { DesignSystemDocumentView } from '../protocol';

const NONE: readonly string[] = [];

interface Watch {
  observer: IntersectionObserver;
  remeasure: () => void;
}

export function useKitPreviewSlots(
  columnRef: RefObject<HTMLElement | null>,
  /** The version the previews build from; a preview only a draft has cannot run. */
  version: Pick<DesignSystemDocumentView, 'cover' | 'sections'>,
) {
  const tiles = useRef(new Map<string, HTMLElement>());
  const inView = useRef(new Set<string>());
  const watch = useRef<Watch | null>(null);
  const callbacks = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const [visible, setVisible] = useState(NONE);
  const [retained, setRetained] = useState(NO_PREVIEW_SLOTS);

  useEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const box = column.getBoundingClientRect();
      const centre = box.top + box.height / 2;
      const distance = (item: string) => {
        const tile = tiles.current.get(item)?.getBoundingClientRect();
        return tile ? Math.abs(tile.top + tile.height / 2 - centre) : Infinity;
      };
      const nearest = [...inView.current].sort((left, right) => distance(left) - distance(right));
      setVisible((current) => (sameOrder(current, nearest) ? current : nearest));
    };
    const remeasure = () => {
      frame ??= requestAnimationFrame(measure);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const item = itemOf(tiles.current, entry.target);
          if (item === null) continue;
          if (entry.isIntersecting) inView.current.add(item);
          else inView.current.delete(item);
        }
        remeasure();
      },
      { root: column },
    );
    watch.current = { observer, remeasure };
    for (const tile of tiles.current.values()) observer.observe(tile);
    // Which of more than four visible tiles is nearest moves with every scroll.
    column.addEventListener('scroll', remeasure, { passive: true });
    return () => {
      column.removeEventListener('scroll', remeasure);
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      watch.current = null;
      inView.current.clear();
    };
  }, [columnRef]);

  /** A stable ref callback per item, so a render does not observe every tile again. */
  const observe = useCallback((item: string) => {
    let callback = callbacks.current.get(item);
    if (!callback) {
      callback = (tile) => {
        const held = tiles.current.get(item);
        if (held) watch.current?.observer.unobserve(held);
        if (tile) {
          tiles.current.set(item, tile);
          watch.current?.observer.observe(tile);
          return;
        }
        // An unobserved tile gets no last callback, so it leaves the view here.
        tiles.current.delete(item);
        inView.current.delete(item);
        watch.current?.remeasure();
      };
      callbacks.current.set(item, callback);
    }
    return callback;
  }, []);

  const slots = reducePreviewSlots(retained, {
    designIds: runnableItems(version),
    visible,
    interacted: null,
    selected: NONE,
  });
  if (slots !== retained) setRetained(slots);
  return { live: slots.live, observe };
}

function runnableItems({ cover, sections }: Pick<DesignSystemDocumentView, 'cover' | 'sections'>) {
  const items = cover?.kind === 'preview' ? ['cover'] : [];
  for (const section of sections)
    for (const item of section.items) if (item.kind === 'preview') items.push(item.id);
  return items;
}

function itemOf(tiles: Map<string, HTMLElement>, target: Element): string | null {
  for (const [item, tile] of tiles) if (tile === target) return item;
  return null;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
