// Spec §4's Components tab: every frame on the canvas the board is showing,
// searchable, with its build state. Enter or a click focuses the frame on the
// board. The search field keeps the keyboard and the arrows walk the matches,
// so a canvas of any size is one tab stop and only the visible rows mount.

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search } from '@droidex/icons';
import { useBoardOnScreen } from './boardOnScreen';
import type { CanvasFrame } from './protocol';

const ROW_PX = 32;

export function CanvasNavigator({ canvasId }: { canvasId: string }) {
  const board = useBoardOnScreen(canvasId);
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
          type="search"
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
            const status = frameStatus(frame);
            return (
              <div
                key={item.key}
                id={`${listId}-${frame.designId}`}
                role="option"
                aria-selected={item.index === activeIndex}
                aria-label={`${frame.name}, ${status.label}`}
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
                <span className="canvas-navigator-name">{frame.name}</span>
                <span className="canvas-navigator-status" data-status={status.tone}>
                  {status.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A frame's build state in a word or two, as the board's sheets word it. */
function frameStatus(frame: CanvasFrame): { label: string; tone: 'quiet' | 'failed' } {
  if (frame.revisionId === null) return { label: 'Empty', tone: 'quiet' };
  switch (frame.build.status) {
    case 'ready':
      return { label: 'Ready', tone: 'quiet' };
    case 'failed':
      return { label: 'Didn’t build', tone: 'failed' };
    case 'building':
      return { label: 'Building', tone: 'quiet' };
    case 'cancelled':
      return { label: 'Build cancelled', tone: 'quiet' };
    case 'pending':
      return { label: 'Waiting to build', tone: 'quiet' };
  }
}
