import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { Browser, ComputerUse, Maximize, X } from '@droidex/icons';
import { useStoreDispatch } from '../../hooks/useStore';
import { imageSrc } from '../../lib/localImage';
import { BrowserPreview } from '../browser/BrowserPreview';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';

const EDGE_PX = 16;
const WIDTH_PX = 320;
const MINIMIZED_WIDTH_PX = 180;
const HEADER_PX = 36;

export type PreviewSource =
  | { kind: 'browser'; browserSessionId: string; title: string }
  | { kind: 'computer'; image?: string; title: string };

export default function ComputerUsePreviewWindow({
  source,
  onInspect,
}: {
  source: PreviewSource;
  onInspect: (src: string) => void;
}) {
  const dispatch = useStoreDispatch();
  const reducedMotion = useReducedMotion();
  const present = useIsPresent();
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState({ right: EDGE_PX, top: 56 });
  const [area, setArea] = useState({ width: window.innerWidth, height: window.innerHeight });
  const windowRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ x: number; y: number; right: number; top: number } | null>(null);
  const dragged = useRef(false);
  const width = Math.max(
    1,
    Math.min(
      minimized ? MINIMIZED_WIDTH_PX : WIDTH_PX,
      area.width - 2 * EDGE_PX,
      minimized ? Infinity : ((area.height - 2 * EDGE_PX - HEADER_PX) * 16) / 10,
    ),
  );
  const height = minimized ? HEADER_PX : HEADER_PX + (width * 10) / 16;
  const fit = (right: number, top: number) => ({
    right: Math.max(EDGE_PX, Math.min(right, area.width - width - EDGE_PX)),
    top: Math.max(EDGE_PX, Math.min(top, area.height - height - EDGE_PX)),
  });
  const shown = fit(position.right, position.top);
  const src = source.kind === 'computer' && source.image ? imageSrc(source.image) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const canExpand = source.kind === 'browser' || (src !== null && src !== failedSrc);
  const Icon = source.kind === 'browser' ? Browser : ComputerUse;

  useEffect(() => {
    const parent = windowRef.current?.offsetParent;
    if (!(parent instanceof HTMLElement)) return;
    const measure = () => {
      setArea({ width: parent.clientWidth, height: parent.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => {
      observer.disconnect();
    };
  }, []);

  const expand = () => {
    if (source.kind === 'browser') dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'browser' });
    else if (canExpand && src) onInspect(src);
  };
  const beginDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    dragged.current = false;
    gesture.current = { x: event.clientX, y: event.clientY, ...shown };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const start = gesture.current;
    if (!start) return;
    if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 3)
      dragged.current = true;
    setPosition(fit(start.right - (event.clientX - start.x), start.top + event.clientY - start.y));
  };
  const endDrag = () => {
    gesture.current = null;
  };

  const sourceName = source.kind === 'browser' ? 'Browser' : 'Computer use';
  const expandLabel = source.kind === 'browser' ? 'Open browser' : 'Enlarge screenshot';

  return (
    <motion.div
      ref={windowRef}
      role="region"
      inert={!present}
      aria-hidden={!present}
      aria-label={`${sourceName} picture in picture`}
      className="absolute z-30 overflow-hidden rounded-xl bg-raised shadow-lg"
      style={{ right: shown.right, top: shown.top }}
      initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.94, y: reducedMotion ? 0 : -8, width }}
      animate={{ opacity: 1, scale: 1, y: 0, width }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -6 }}
      transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex h-9 items-center gap-1 px-1">
        <button
          type="button"
          ref={headerRef}
          className="flex h-control-sm min-w-0 flex-1 cursor-grab touch-none select-none items-center gap-1.5 rounded-md px-2 text-left text-label text-secondary transition-colors duration-150 hover:bg-elevated active:cursor-grabbing"
          aria-label={`${minimized ? 'Show' : 'Move'} ${sourceName.toLowerCase()} preview`}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={() => {
            endDrag();
            dragged.current = false;
          }}
          onLostPointerCapture={endDrag}
          onClick={() => {
            if (minimized && !dragged.current) setMinimized(false);
            dragged.current = false;
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 32 : 8;
            let { right, top } = shown;
            switch (event.key) {
              case 'ArrowLeft':
                right += step;
                break;
              case 'ArrowRight':
                right -= step;
                break;
              case 'ArrowUp':
                top -= step;
                break;
              case 'ArrowDown':
                top += step;
                break;
              default:
                return;
            }
            event.preventDefault();
            setPosition(fit(right, top));
          }}
        >
          <Icon className="size-icon-sm shrink-0" aria-hidden="true" />
          <span className="truncate">{minimized ? 'Show preview' : source.title}</span>
        </button>
        {!minimized && (
          <>
            <Tooltip label={expandLabel}>
              <Button
                variant="ghost"
                size="sm"
                icon={Maximize}
                aria-label={expandLabel}
                onClick={expand}
                disabled={!canExpand}
              />
            </Tooltip>
            <Tooltip label="Hide preview">
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                aria-label="Hide preview"
                onClick={() => {
                  setMinimized(true);
                  // This button unmounts, so keep keyboard focus on the restore control.
                  headerRef.current?.focus();
                }}
              />
            </Tooltip>
          </>
        )}
      </div>
      <AnimatePresence initial={false}>
        {!minimized && (
          <motion.div
            key="picture"
            initial={{ height: 0 }}
            animate={{ height: (width * 10) / 16 }}
            exit={{ height: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
            className="overflow-hidden"
          >
            {source.kind === 'browser' ? (
              <BrowserPreview
                key={source.browserSessionId}
                browserSessionId={source.browserSessionId}
              />
            ) : (
              <button
                type="button"
                onClick={expand}
                disabled={!canExpand}
                className="relative block aspect-browser w-full bg-elevated disabled:cursor-default"
                aria-label="Enlarge computer-use screenshot"
              >
                {src && src !== failedSrc ? (
                  <img
                    src={src}
                    alt="Agent's latest computer-use screenshot"
                    draggable={false}
                    onError={() => {
                      setFailedSrc(src);
                    }}
                    className="h-full w-full select-none object-contain"
                  />
                ) : (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
                    <ComputerUse className="size-icon-lg" aria-hidden="true" />
                    <span className="text-caption">
                      {src ? 'Screenshot unavailable' : 'Waiting for a screenshot…'}
                    </span>
                  </span>
                )}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
