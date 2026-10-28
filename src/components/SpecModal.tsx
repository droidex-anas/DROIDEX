import { useRef, useEffect, useEffectEvent, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, FileText } from '@droidex/icons';
import { pushEscapeLayer } from './ui/escapeStack';
import { wrapTabFocus } from '../lib/focusTrap';
import { Button } from './ui/Button';
import { SpecRenderer } from './SpecRenderer';
import { SpecOutline, useSpecOutline } from './SpecOutline';

// Dialog motion (docs/design-system/feel.md): 180ms smooth-out in, 120ms
// ease-in out.
const EASE = [0.22, 1, 0.36, 1] as const;

function useActiveHeading(scrollRef: React.RefObject<HTMLDivElement | null>, headingIds: string[]) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || headingIds.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { root: container, rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );

    headingIds.forEach((id) => {
      const el = container.querySelector(`#${CSS.escape(id)}`);
      if (el) observer.observe(el);
    });

    return () => {
      observer.disconnect();
    };
  }, [scrollRef, headingIds]);

  return activeId;
}

export function SpecModal({
  content,
  title,
  open,
  onClose,
}: {
  content: string;
  title?: string;
  open: boolean;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const reduceMotion = useReducedMotion();

  // Reduced motion (docs/design-system/feel.md): the dialog cross-fades
  // instead of translating and scaling.
  const hidden = reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 };
  const shown = reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 };

  const outline = useSpecOutline(open ? content : '');
  const headingIds = useMemo(() => outline.map((h) => h.id), [outline]);
  const activeId = useActiveHeading(scrollRef, headingIds);

  const scrollTo = useCallback(
    (id: string) => {
      const container = scrollRef.current;
      if (!container) return;
      const el = container.querySelector(`#${CSS.escape(id)}`);
      if (el) {
        // 'instant' also overrides the container's CSS smooth scrolling.
        el.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth', block: 'start' });
      }
    },
    [reduceMotion],
  );

  // Reset search on open
  useEffect(() => {
    if (open) setSearchQuery('');
  }, [open]);

  // Dialog contract: Escape closes through the shared LIFO layer stack, Tab
  // stays inside, and focus returns to the opener when the dialog closes.
  // Tied to `open` only, so a caller's new `onClose` on a rerender neither
  // refocuses the panel nor moves its Escape layer above a later one.
  const close = useEffectEvent(onClose);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });
    let focusInside = true;
    const track = () => {
      focusInside = panel?.contains(document.activeElement) ?? false;
    };
    document.addEventListener('focusin', track);
    const popEscape = pushEscapeLayer(() => {
      close();
    });
    return () => {
      document.removeEventListener('focusin', track);
      popEscape();
      if (focusInside && opener?.isConnected) opener.focus();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12, ease: 'easeIn' }}
          className="fixed inset-0 z-dialog flex items-center justify-center bg-bg/60 p-8"
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title?.length ? title : 'Specification'}
            tabIndex={-1}
            initial={hidden}
            animate={shown}
            exit={{ ...hidden, transition: { duration: 0.12, ease: 'easeIn' } }}
            transition={{ duration: 0.18, ease: EASE }}
            onKeyDown={(e) => {
              wrapTabFocus(e, panelRef.current);
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-surface shadow-lg"
          >
            {/* Header */}
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-6">
              <div className="flex min-w-0 items-center gap-2.5">
                <FileText className="size-icon-md shrink-0 text-muted" aria-hidden="true" />
                <span className="truncate text-heading text-primary">
                  {title?.length ? title : 'Specification'}
                </span>
                {outline.length > 0 && (
                  <span className="ml-1 shrink-0 text-caption tabular-nums text-muted">
                    {outline.length} sections
                  </span>
                )}
              </div>
              <Button variant="ghost" size="sm" icon={X} aria-label="Close" onClick={onClose} />
            </div>

            {/* Body */}
            <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
              {/* Document */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth"
              >
                <div className="max-w-4xl mx-auto px-10 py-10 min-h-full">
                  {content ? (
                    <SpecRenderer content={content} />
                  ) : (
                    <div className="flex items-center justify-center h-full text-body text-muted">
                      No spec content available.
                    </div>
                  )}
                </div>
              </div>

              {/* Outline */}
              <SpecOutline
                headings={outline}
                activeId={activeId}
                onSelect={scrollTo}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
