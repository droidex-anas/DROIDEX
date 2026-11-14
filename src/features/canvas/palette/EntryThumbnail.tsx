// A Components row's picture of its entry, in the frame's kit and mode: the
// entry's capture, else the entry running live at the thumbnail's scale until
// its first render is kept as that capture, else a quiet tone. Every row of a
// catalog mounts, so a thumbnail reads its capture only once it has scrolled
// into view, and only a few in view run live at once.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { KitGuest } from '../KitGuest';
import { ENTRY_THUMBNAIL, useKitCapture } from '../kitCaptures';
import type { DesignSystemRef, KitPreviewTarget } from '../protocol';

// The entry's page, in the thumbnail's 8:5; its capture is cropped to the entry.
const STAGE = { width: 480, height: 300 };
// Each live thumbnail is a guest process, so a long catalog fills in a few at a time.
const LIVE_SLOTS = 2;
const NO_TOKENS: Readonly<Record<string, string>> = {};

export function EntryThumbnail({ kit, entry }: { kit: DesignSystemRef; entry: string }) {
  const box = useRef<HTMLDivElement>(null);
  const view = useView(box);
  const item = useMemo(() => ({ entry }), [entry]);
  const capture = useKitCapture(view.seen ? kit : null, item);
  const [failed, setFailed] = useState(false);
  const isLive = useLiveSlot(view.visible && capture === null && !failed);
  const { id, version, mode } = kit;
  const target = useMemo(
    (): KitPreviewTarget => ({ kind: 'catalog', ref: { id, version, mode }, entry, props: [] }),
    [id, version, mode, entry],
  );
  return (
    <div
      ref={box}
      aria-hidden
      className="relative h-10 w-16 shrink-0 overflow-hidden rounded-sm bg-elevated"
    >
      {capture ? (
        <img
          src={capture}
          alt=""
          draggable={false}
          className="kit-tile-reveal absolute inset-0 size-full object-cover"
        />
      ) : (
        isLive && (
          <KitGuest
            kit={kit}
            target={target}
            width={STAGE.width}
            height={STAGE.height}
            scale={ENTRY_THUMBNAIL.width / STAGE.width}
            draftTokens={NO_TOKENS}
            capture={item}
            onFailed={() => {
              setFailed(true);
            }}
          />
        )
      )}
    </div>
  );
}

/** Whether the element is in view now, and whether it has been since it mounted. */
function useView(ref: RefObject<HTMLElement | null>) {
  const [view, setView] = useState({ seen: false, visible: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver((changes) => {
      const visible = changes.at(-1)?.isIntersecting ?? false;
      setView((was) => ({ seen: was.seen || visible, visible }));
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return view;
}

// The thumbnails waiting to run live, first come first served; the first LIVE_SLOTS run.
let queue: readonly symbol[] = [];
const listeners = new Set<() => void>();

function setQueue(next: readonly symbol[]): void {
  queue = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useLiveSlot(wanted: boolean): boolean {
  const [token] = useState(() => Symbol('thumbnail'));
  useEffect(() => {
    if (!wanted) return;
    setQueue([...queue, token]);
    return () => {
      setQueue(queue.filter((each) => each !== token));
    };
  }, [wanted, token]);
  return useSyncExternalStore(subscribe, () => {
    const place = queue.indexOf(token);
    return place >= 0 && place < LIVE_SLOTS;
  });
}
