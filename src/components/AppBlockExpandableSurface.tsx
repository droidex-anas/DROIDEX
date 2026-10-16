import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Maximize, Minimize } from '@droidex/icons';
import { Button } from './ui/Button';
import { Tooltip } from './ui/Tooltip';

export interface AppExpansion {
  // The transcript row keeps the inline height while the App sits in the top
  // layer, so the conversation behind it neither jumps nor re-measures.
  placeholderHeight: number;
}

/**
 * Hosts a running App inline and, on request, lifts the same element into the
 * top layer as a window-filling view. Moving the frame's DOM node would reload
 * the App and lose its state, and transcript rows are transformed, so neither
 * a portal nor `position: fixed` works; a popover escapes both in place.
 */
export function ExpandableAppSurface({
  expansion,
  canExpand,
  onExpand,
  onCollapse,
  children,
}: {
  expansion: AppExpansion | null;
  canExpand: boolean;
  onExpand: (expansion: AppExpansion) => void;
  onCollapse: () => void;
  children: ReactNode;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const isExpanded = expansion !== null;

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!isExpanded || !surface) return;
    const expandButton = expandButtonRef.current;
    if (!surface.matches(':popover-open')) surface.showPopover();
    collapseButtonRef.current?.focus();
    // Capture phase, so Escape leaves the expanded view before the chat's own
    // Escape shortcuts can act on the conversation hidden behind it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCollapse();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && surface.contains(event.target)) return;
      collapseButtonRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      const focused = document.activeElement;
      if (focused === null || focused === document.body || surface.contains(focused)) {
        expandButton?.focus();
      }
    };
  }, [isExpanded, onCollapse]);

  return (
    <div className="group min-w-0">
      <div
        className="min-w-0"
        style={expansion ? { height: expansion.placeholderHeight } : undefined}
      >
        <div
          ref={surfaceRef}
          popover={isExpanded ? 'manual' : undefined}
          role={isExpanded ? 'dialog' : undefined}
          aria-modal={isExpanded ? true : undefined}
          aria-label={isExpanded ? 'Visualization' : undefined}
          onClick={
            isExpanded
              ? (event) => {
                  if (event.target === event.currentTarget) onCollapse();
                }
              : undefined
          }
          className={
            isExpanded
              ? 'cue-enter fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none justify-center overflow-hidden border-0 bg-bg/60 p-3 text-primary sm:p-6'
              : 'min-w-0'
          }
        >
          <div
            className={
              isExpanded
                ? 'flex h-full w-full max-w-screen-2xl flex-col overflow-hidden rounded-xl bg-bg shadow-lg'
                : 'min-w-0'
            }
          >
            {isExpanded && (
              <div className="flex h-12 shrink-0 items-center gap-3 pl-5 pr-2.5">
                <span className="min-w-0 flex-1 truncate text-body-strong text-secondary">
                  Visualization
                </span>
                <span className="hidden text-caption text-muted sm:inline">Esc to close</span>
                <Button
                  ref={collapseButtonRef}
                  variant="ghost"
                  icon={Minimize}
                  onClick={onCollapse}
                  aria-label="Exit full screen"
                  title="Exit full screen"
                />
              </div>
            )}
            <div
              className={
                isExpanded
                  ? 'flex min-h-0 flex-1 flex-col overflow-auto overscroll-contain px-4 pb-4 sm:px-8 sm:pb-8'
                  : 'min-w-0'
              }
            >
              <div
                className={
                  isExpanded ? 'relative my-auto w-full min-w-0 shrink-0' : 'relative min-w-0'
                }
              >
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Outside the frame, so the button never covers the App's own controls. */}
      {canExpand && (
        <div className="mt-1 flex justify-end opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          <Tooltip label="Full screen">
            <Button
              ref={expandButtonRef}
              variant="ghost"
              size="sm"
              icon={Maximize}
              aria-label="Open visualization full screen"
              tabIndex={isExpanded ? -1 : undefined}
              onClick={() => {
                const surface = surfaceRef.current;
                if (!surface) return;
                onExpand({ placeholderHeight: surface.offsetHeight });
              }}
            />
          </Tooltip>
        </div>
      )}
    </div>
  );
}
