// The dialog's left column: the New menu, the three presets, then the user's
// kits, each with its surface and accent for the previewed mode.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from '@droidex/icons';
import { usePopover } from '../../components/environment/usePopover';
import { paintable } from './designSystemTokenTabs';
import type { PreviewMode } from './DesignSystemDetail';
import { sameKit, type KitList } from './designSystemsState';
import { MenuHeading, MenuNote, MenuRow } from './menuRows';
import type { DesignSystemSource, DesignSystemSummary, DesignSystemVersionRef } from './protocol';

export function DesignSystemList({
  list,
  selected,
  mode,
  onSelect,
  onCompose,
  onRetry,
}: {
  list: KitList;
  selected: DesignSystemVersionRef | null;
  mode: PreviewMode;
  onSelect: (ref: DesignSystemVersionRef) => void;
  onCompose: (kind: DesignSystemSource['kind']) => void;
  onRetry: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const newRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    newRef.current?.focus();
  }, []);
  // In place rather than portalled: a portalled popover would open beneath the dialog.
  const menuRef = usePopover(menuOpen, closeMenu);
  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen, menuRef]);
  const compose = (kind: DesignSystemSource['kind']) => {
    setMenuOpen(false);
    onCompose(kind);
  };
  const row = (kit: DesignSystemSummary) => (
    <KitRow
      key={kit.id}
      kit={kit}
      mode={mode}
      selected={sameKit(kit, selected)}
      onSelect={() => {
        onSelect({ id: kit.id, version: kit.version });
      }}
    />
  );

  // Kit ids are opaque, so the user's kits read in name order.
  const yours =
    list.status === 'listed'
      ? list.systems
          .filter((kit) => kit.kind === 'user')
          .sort((left, right) => left.name.localeCompare(right.name))
      : [];

  return (
    <nav
      aria-label="Design systems"
      className="flex w-[248px] shrink-0 flex-col bg-droid-surface/40"
    >
      <div className="flex items-center gap-2 px-4 pb-2 pt-5">
        <h2 id="design-systems-title" className="flex-1 text-[14px] font-semibold text-droid-text">
          Design systems
        </h2>
        <div ref={menuRef} className="relative">
          <button
            ref={newRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" />
            New
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="New design system"
              className="absolute right-0 top-full z-10 mt-1 w-52 rounded-xl bg-droid-raised p-1 shadow-droid"
            >
              <MenuRow
                label="From DESIGN.md"
                onRun={() => {
                  compose('designMd');
                }}
              />
              <MenuRow
                label="From CSS or Tailwind config"
                onRun={() => {
                  compose('cssOrTailwind');
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {list.status === 'loading' && <MenuNote role="status">Reading design systems…</MenuNote>}
        {list.status === 'failed' && (
          <div role="alert" className="flex flex-col items-start gap-2 px-2.5 pt-2">
            <p className="text-[12px] text-droid-red">{list.message}</p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-droid-active px-2.5 py-1 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15"
            >
              Try again
            </button>
          </div>
        )}
        {list.status === 'listed' && (
          <>
            <MenuHeading>Presets</MenuHeading>
            {list.systems.filter((kit) => kit.kind === 'preset').map(row)}
            <MenuHeading>Yours</MenuHeading>
            {yours.length > 0 ? (
              yours.map(row)
            ) : (
              <MenuNote>None yet. Start one from New, or save a copy of a preset.</MenuNote>
            )}
          </>
        )}
      </div>
    </nav>
  );
}

function KitRow({
  kit,
  mode,
  selected,
  onSelect,
}: {
  kit: DesignSystemSummary;
  mode: PreviewMode;
  selected: boolean;
  onSelect: () => void;
}) {
  const { surface, accent } = kit.swatches[mode];
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/15 ${
        selected ? 'bg-droid-active font-medium' : 'hover:bg-droid-accent/10'
      }`}
    >
      <span className="min-w-0 flex-1 truncate text-[12px] text-droid-text">{kit.name}</span>
      {[surface, accent].map((color, index) => (
        <span
          key={index}
          aria-hidden
          className="h-3 w-3 shrink-0 rounded-full ring-1 ring-inset ring-droid-border"
          style={{ background: paintable(color) }}
        />
      ))}
    </button>
  );
}
