import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { Check } from '@droidex/icons';
import { usePopover } from './environment/usePopover';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import type { ProductMode } from '../hooks/persistedUiPreferences';
import { BrandMark } from './BrandMark';

const MODES: { mode: ProductMode; label: string; hint: string }[] = [
  { mode: 'chat', label: 'Chat', hint: 'Chats and their work' },
  { mode: 'design', label: 'Design', hint: 'Canvases of working interfaces' },
];

/**
 * The wordmark in the sidebar's brand row, which is also how the user moves
 * between Chat and Design (spec §4). The menu stays inside the sidebar's width,
 * so it needs no portal.
 */
export function ProductSwitcher() {
  const [open, setOpen] = useState(false);
  const { productMode, label } = useStoreSelector(
    (current) => ({
      productMode: current.productMode,
      label: current.productMode === 'design' ? 'Design' : 'Chat',
    }),
    shallowEqual,
  );
  const dispatch = useStoreDispatch();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const ref = usePopover(open, close);

  const select = (mode: ProductMode) => {
    close();
    if (mode === productMode) return;
    dispatch({ type: 'SET_PRODUCT_MODE', mode });
    // Design opens on its home, the way Chat opens on a chat. That home is the
    // new-canvas draft, so entering the product starts one: folder-less, and
    // asking for a canvas of its own on the first send (spec §4).
    if (mode === 'design') {
      dispatch({ type: 'START_CHAT', cwd: '', executionMode: 'local', canvas: { canvasId: null } });
    }
  };

  // Arrows walk the two rows; the menu is short enough that wrapping at either
  // end reads as one loop rather than a dead end.
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const rows = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []),
    ];
    const here = rows.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    rows[(here + step + rows.length) % rows.length]?.focus();
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`DROIDEX — ${label}. Switch product`}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-droid-text transition-colors hover:bg-droid-elevated/50"
      >
        <BrandMark size={13} />
        <span className="text-[11px] font-medium text-droid-text-muted">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Product"
          onKeyDown={walk}
          className="absolute left-0 top-full z-50 mt-1 w-[220px] rounded-xl bg-droid-raised p-1 shadow-droid"
        >
          {MODES.map((entry) => (
            <button
              key={entry.mode}
              type="button"
              role="menuitemradio"
              aria-checked={entry.mode === productMode}
              autoFocus={entry.mode === productMode}
              onClick={() => {
                select(entry.mode);
              }}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-droid-accent/10 focus-visible:bg-droid-accent/10 focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-droid-text">{entry.label}</span>
                <span className="block text-[11px] text-droid-text-muted">{entry.hint}</span>
              </span>
              {entry.mode === productMode && (
                <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-droid-accent" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
