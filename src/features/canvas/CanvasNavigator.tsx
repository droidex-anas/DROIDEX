// Spec §4's Components tab: every frame on the canvas the board is showing,
// searchable, with its last picture and the stage the board shows for it.
// Enter or a click focuses the frame on the board. The search field keeps the
// keyboard and the arrows walk the matches, so a canvas of any size is one tab
// stop and only the visible rows mount.

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search } from '@droidex/icons';
import './canvasAnimations.css';
import './canvasBloom.css';
import { useBoardOnScreen } from './boardOnScreen';
import { canvasActivity, type CanvasMotion } from './canvasMotion';
import { FrameThumbnail } from './FrameThumbnail';
import { PendingBloom } from './PendingBloom';
import { frameStatus, type FrameStatus } from './previewLabels';
import type { CanvasFrame } from './protocol';
import { useCanvasMotion } from './useCanvasMotion';

const ROW_PX = 48;

export function CanvasNavigator({ canvasId }: { canvasId: string }) {
  const board = useBoardOnScreen(canvasId);
  const motion = useCanvasMotion();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const frames = board?.frames ?? [];
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? frames.filter((frame) => frame.name.toLowerCase().includes(needle))
    : frames;
  const activeIndex = Math.min(active, matches.length - 1);
  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => list.current,
    getItemKey: (index) => matches[index].designId,
    estimateSize: () => ROW_PX,
    overscan: 8,
  });
  const selected = new Set(board?.selected.map((frame) => frame.designId));

  const focus = (frame: CanvasFrame) => {
    board?.focusFrame(frame.designId);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined && matches.length > 0) {
      event.preventDefault();
      const next = (activeIndex + step + matches.length) % matches.length;
      setActive(next);
      virtualizer.scrollToIndex(next);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      focus(matches[activeIndex]);
    } else if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    }
  };

  if (!board)
    return (
      <p role="status" className="canvas-navigator-note">
        The canvas is still opening. Its frames are listed here once the board is up.
      </p>
    );
  return (
    <div className="canvas-navigator">
      <label className="canvas-navigator-search">
        <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <input
          type="text"
          role="combobox"
          aria-label="Search frames"
          aria-controls={listId}
          aria-expanded
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-${matches[activeIndex].designId}` : undefined
          }
          placeholder="Search frames"
          spellCheck={false}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {frames.length === 0 && (
        <p className="canvas-navigator-note">
          No frames on this canvas yet. Ask the agent for a design to start one.
        </p>
      )}
      {frames.length > 0 && matches.length === 0 && (
        <p role="status" className="canvas-navigator-note">
          No frames match “{query.trim()}”.
        </p>
      )}
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label="Frames"
        className="canvas-navigator-list"
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const frame = matches[item.index];
            const status = frameStatus(frame, board.agentWorking);
            return (
              <div
                key={item.key}
                id={`${listId}-${frame.designId}`}
                role="option"
                aria-selected={item.index === activeIndex}
                aria-label={`${frame.name}, ${status.stage ? canvasActivity[status.stage].label : 'Empty'}`}
                data-picked={selected.has(frame.designId) || undefined}
                className="canvas-navigator-row"
                style={{ transform: `translateY(${String(item.start)}px)` }}
                onPointerDown={(event) => {
                  // The search field keeps the keyboard.
                  event.preventDefault();
                }}
                onClick={() => {
                  setActive(item.index);
                  focus(frame);
                }}
              >
                <span className="canvas-navigator-thumb">
                  {status.revisionId !== null && (
                    <FrameThumbnail
                      canvasId={canvasId}
                      designId={frame.designId}
                      revisionId={status.revisionId}
                      fallback={null}
                    />
                  )}
                </span>
                <span className="canvas-navigator-text">
                  <span className="canvas-navigator-name">{frame.name}</span>
                  <FrameMeta frame={frame} stage={status.stage} motion={motion} />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A working frame's size; any other frame's stage, in the board's own words. */
function FrameMeta({
  frame,
  stage,
  motion,
}: {
  frame: CanvasFrame;
  stage: FrameStatus['stage'];
  motion: CanvasMotion;
}) {
  if (stage === 'ready')
    return (
      <span className="canvas-navigator-meta">
        {Math.round(frame.rect.width)} × {Math.round(frame.rect.height)}
      </span>
    );
  return (
    <span className="canvas-navigator-meta" data-failed={stage === 'failed' || undefined}>
      {/* Only the visible rows mount, so a mounted row is a visible one. */}
      {stage ? <PendingBloom stage={stage} visible motion={motion} /> : 'Empty'}
    </span>
  );
}
