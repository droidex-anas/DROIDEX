import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, RefObject } from 'react';
import { CornerDownLeft } from 'lucide-react';
import type { ConversationAnchor } from './chatFeedTurns';
import { cn } from './ui/cn';
import { usePopoverPosition } from './ui/usePopoverPosition';

// Moving from a tick onto its preview card crosses a small gap.
const PREVIEW_HIDE_DELAY_MS = 100;

/**
 * A quiet navigation rail in the chat's left gutter: one short tick per user
 * prompt. The tick list is derived from transcript data (so it always matches
 * the feed), while scrolling and the "you are here" highlight resolve the
 * rendered row by its `data-anchor-id`. Hovering or keyboard focus previews the
 * prompt and its reply; clicking or Enter scrolls the prompt to the top. Long
 * threads scroll the rail itself rather than growing past the viewport.
 */
export const ConversationTimeline = memo(function ConversationTimeline({
  scrollRef,
  anchors,
  onJumpToAnchor,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  anchors: ConversationAnchor[];
  onJumpToAnchor: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const previewAnchorRef = useRef<HTMLElement | null>(null);
  const hideTimerRef = useRef<number | undefined>(undefined);
  // The prompt a jump is scrolling to, until the feed has mounted it.
  const jumpTargetRef = useRef<string | null>(null);

  // A stable identity for the anchor set. `anchors` is rebuilt on every
  // transcript token, but the highlight reader only needs to reset when the
  // actual set of prompt ids changes.
  const anchorKey = anchors.map((a) => a.id).join('\n');

  // Highlight the prompt nearest the top of the viewport as the user scrolls,
  // including one a jump placed exactly at the top.
  // Query currently mounted anchors on rAF so a virtual window can remount rows
  // without rebuilding an IntersectionObserver.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || anchors.length === 0) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      // While a jump is in flight the windowed feed can still hold the rows it
      // is leaving, so keep the jump target highlighted until it mounts.
      const jumpTarget = jumpTargetRef.current;
      if (jumpTarget) {
        if (!root.querySelector(`[data-anchor-id="${CSS.escape(jumpTarget)}"]`)) return;
        jumpTargetRef.current = null;
      }
      const rootRect = root.getBoundingClientRect();
      const cutoff = rootRect.top + rootRect.height * 0.35;
      let bestId: string | null = null;
      let bestTop = Infinity;
      for (const el of root.querySelectorAll<HTMLElement>('[data-anchor-id]')) {
        const id = el.dataset.anchorId;
        if (!id) continue;
        const top = el.getBoundingClientRect().top;
        if (top < rootRect.top - 1 || top > cutoff) continue;
        if (top < bestTop) {
          bestTop = top;
          bestId = id;
        }
      }
      if (bestId) setActiveId(bestId);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };
    const onUserScroll = () => {
      jumpTargetRef.current = null;
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('wheel', onUserScroll, { passive: true });
    root.addEventListener('pointerdown', onUserScroll);
    update();
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('wheel', onUserScroll);
      root.removeEventListener('pointerdown', onUserScroll);
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- anchorKey stands in for anchors
  }, [scrollRef, anchorKey]);

  // Keep the "you are here" tick inside the rail's own scroller. Re-run when
  // the tick set changes too: an older-history page prepends ticks above the
  // active one, sliding it down without any activeId change.
  useEffect(() => {
    if (activeId) revealTick(railRef.current, activeId);
  }, [activeId, anchorKey]);

  useEffect(
    () => () => {
      window.clearTimeout(hideTimerRef.current);
    },
    [],
  );

  if (anchors.length < 2) return null;

  const jump = (id: string) => {
    jumpTargetRef.current = id;
    setActiveId(id);
    onJumpToAnchor(id);
  };
  const showPreview = (tick: HTMLElement, id: string) => {
    window.clearTimeout(hideTimerRef.current);
    previewAnchorRef.current = tick;
    setPreviewId(id);
  };
  const hidePreviewSoon = () => {
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setPreviewId(null);
    }, PREVIEW_HIDE_DELAY_MS);
  };
  const keepPreview = () => {
    window.clearTimeout(hideTimerRef.current);
  };

  // Roving focus: one tick is in the tab order, the arrows walk the rest.
  const focusIndex = Math.max(
    0,
    anchors.findIndex((a) => a.id === activeId),
  );
  const onRailKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const ticks = Array.from(
      railRef.current?.querySelectorAll<HTMLButtonElement>('[data-tick-id]') ?? [],
    );
    const current = ticks.findIndex((tick) => tick === document.activeElement);
    if (current < 0) return;
    if (event.key === 'Escape' && previewId) {
      event.stopPropagation();
      setPreviewId(null);
      return;
    }
    let next: number;
    if (event.key === 'ArrowDown') next = Math.min(current + 1, ticks.length - 1);
    else if (event.key === 'ArrowUp') next = Math.max(current - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = ticks.length - 1;
    else return;
    event.preventDefault();
    const tick = ticks[next];
    tick.focus({ preventScroll: true });
    revealTick(railRef.current, tick.dataset.tickId ?? '');
  };

  const previewIndex = previewId ? anchors.findIndex((a) => a.id === previewId) : -1;
  const preview = previewIndex >= 0 ? anchors[previewIndex] : undefined;

  return (
    <div className="pointer-events-none absolute inset-y-24 left-1 z-10 hidden items-center lg:flex">
      <div
        ref={railRef}
        role="navigation"
        aria-label="Prompts in this chat"
        onKeyDown={onRailKeyDown}
        className="no-scrollbar pointer-events-auto flex max-h-full flex-col overflow-y-auto py-1"
      >
        {anchors.map((a, index) => {
          const isActive = a.id === activeId;
          const distance = previewIndex >= 0 ? Math.abs(index - previewIndex) : Infinity;
          return (
            <button
              key={a.id}
              data-tick-id={a.id}
              data-active={isActive || undefined}
              type="button"
              tabIndex={index === focusIndex ? 0 : -1}
              aria-label={`Prompt ${String(index + 1)} of ${String(anchors.length)}: ${a.label}`}
              aria-current={isActive ? 'location' : undefined}
              onClick={() => {
                jump(a.id);
              }}
              onMouseEnter={(event) => {
                showPreview(event.currentTarget, a.id);
              }}
              onMouseLeave={hidePreviewSoon}
              onFocus={(event) => {
                if (event.currentTarget.matches(':focus-visible')) {
                  showPreview(event.currentTarget, a.id);
                }
              }}
              onBlur={hidePreviewSoon}
              className="flex h-2.5 w-8 shrink-0 cursor-pointer items-center rounded-xs pl-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-focus-ring"
            >
              <span
                className={cn(
                  'h-0.5 rounded-full transition-all duration-150 ease-smooth-out motion-reduce:transition-none',
                  tickTone(distance, isActive),
                )}
              />
            </button>
          );
        })}
      </div>
      {preview && (
        <PromptPreview
          key={preview.id}
          anchorRef={previewAnchorRef}
          anchor={preview}
          onPointerEnter={keepPreview}
          onPointerLeave={hidePreviewSoon}
          onJump={() => {
            jump(preview.id);
          }}
        />
      )}
    </div>
  );
});

// Dock-style magnification: the previewed tick grows longest and brightest and
// its neighbours less, falling off over three ticks; at rest only the current
// prompt stands out.
function tickTone(distanceFromPreview: number, isActive: boolean): string {
  if (distanceFromPreview === 0) return 'w-6 bg-primary';
  if (distanceFromPreview === 1) return 'w-4 bg-secondary';
  if (distanceFromPreview === 2) return 'w-3 bg-muted';
  if (distanceFromPreview === 3) return 'w-2 bg-muted/70';
  if (isActive) return 'w-3 bg-secondary';
  return 'w-1.5 bg-muted/40';
}

// Scroll only the rail: scrollIntoView could also move ancestor scrollers,
// including the feed.
function revealTick(rail: HTMLElement | null, id: string) {
  const tick = rail?.querySelector<HTMLElement>(`[data-tick-id="${CSS.escape(id)}"]`);
  if (!rail || !tick) return;
  const railRect = rail.getBoundingClientRect();
  const tickRect = tick.getBoundingClientRect();
  if (tickRect.top < railRect.top) {
    rail.scrollTo({ top: rail.scrollTop + (tickRect.top - railRect.top) - 8, behavior: 'smooth' });
  } else if (tickRect.bottom > railRect.bottom) {
    rail.scrollTo({
      top: rail.scrollTop + (tickRect.bottom - railRect.bottom) + 8,
      behavior: 'smooth',
    });
  }
}

// The hover card beside a tick. It is keyed per tick so each opening anchors
// afresh; the tick's own label already names the prompt for screen readers.
function PromptPreview({
  anchorRef,
  anchor,
  onPointerEnter,
  onPointerLeave,
  onJump,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  anchor: ConversationAnchor;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onJump: () => void;
}) {
  const { setFloating, floatingStyles, side, isPositioned } = usePopoverPosition({
    open: true,
    anchorRef,
    placement: 'right',
    offsetPx: 8,
  });
  return createPortal(
    <div ref={setFloating} style={floatingStyles} className="z-tooltip">
      <div
        aria-hidden
        data-side={side}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onClick={onJump}
        className={cn(
          'floating-layer w-64 cursor-pointer rounded-lg bg-raised px-3 py-2 shadow-lg',
          isPositioned ? 'floating-layer-enter' : 'opacity-0',
        )}
      >
        <div className="truncate text-body-strong text-primary">{anchor.label}</div>
        {anchor.reply && (
          <div className="mt-1 line-clamp-2 text-body text-muted">{anchor.reply}</div>
        )}
        <div className="mt-2 flex items-center gap-1.5 text-caption text-muted">
          <CornerDownLeft className="size-icon-sm shrink-0" />
          Jump to prompt
        </div>
      </div>
    </div>,
    document.body,
  );
}
