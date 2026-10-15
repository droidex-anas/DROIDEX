import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { pushEscapeLayer } from './ui/escapeStack';
import { wrapTabFocus } from '../lib/focusTrap';

// Shared chrome for the command-palette overlays (⌘K command palette,
// sidebar session search): backdrop, animated dialog, search input row, and
// the keyboard-hint footer. Consumers own their state, filtering, and result
// rows (rendered as children) via usePaletteNavigation. The body portal keeps
// transformed or clipped ancestors from containing the viewport overlay.
export default function PaletteShell({
  onClose,
  query,
  onQueryChange,
  onKeyDown,
  placeholder,
  inputAriaLabel,
  enterHint,
  footerRight,
  children,
}: {
  onClose: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  placeholder: string;
  inputAriaLabel: string;
  enterHint: string;
  footerRight?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    inputRef.current?.focus();
    let focusInside = true;
    const trackFocus = () => {
      focusInside = !!panel?.contains(document.activeElement);
    };
    document.addEventListener('focusin', trackFocus);
    return () => {
      document.removeEventListener('focusin', trackFocus);
      if (focusInside && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => pushEscapeLayer(onClose), [onClose]);

  const trapTab = (event: React.KeyboardEvent) => {
    wrapTabFocus(event, panelRef.current);
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-dialog flex items-center justify-center bg-bg/60 p-4"
      onClick={onClose}
    >
      <motion.div
        ref={panelRef}
        onKeyDown={trapTab}
        style={{ zoom: 'var(--ui-zoom, 1)' }}
        role="dialog"
        aria-modal="true"
        aria-label={inputAriaLabel}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        // Capped at the room the backdrop's padding leaves, so the dialog
        // scrolls inside instead of running off the window.
        className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-raised shadow-lg"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="flex items-center gap-3 px-4 pt-3.5 pb-2.5">
          <Search className="size-icon-md shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={inputAriaLabel}
            className="min-w-0 flex-1 bg-transparent text-body-lg text-primary placeholder-muted focus:outline-none"
          />
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="flex size-control-sm shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-active hover:text-primary"
          >
            <X className="size-icon-md" />
          </button>
        </div>

        {/* A fixed result height keeps the centred dialog, and so the search
            field, from moving as filtering changes the number of results. */}
        <div className="h-80 min-h-0 overflow-y-auto px-1.5">{children}</div>

        <div className="flex items-center justify-between gap-3 px-4 pt-2.5 pb-3">
          <div className="flex items-center gap-3 text-caption text-muted">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-xs bg-active px-1 py-0.5 font-sans text-caption">↑↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded-xs bg-active px-1 py-0.5 font-sans text-caption">↵</kbd>
              {enterHint}
            </span>
          </div>
          {footerRight && <div className="truncate text-caption text-muted">{footerRight}</div>}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
