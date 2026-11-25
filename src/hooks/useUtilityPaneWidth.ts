import { useCallback, useEffect, useState, type RefObject } from 'react';

const UTILITY_PANE_MIN = 420;
const UTILITY_PANE_MAX = 980;
const UTILITY_PANE_DEFAULT = 560;
const UTILITY_PANE_CONTENT_RESERVE = 520;
const UTILITY_PANE_WIDTH_STORAGE_KEY = 'droid-utility-pane-width';

export function useUtilityPaneWidth(contentRowRef: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(initialUtilityPaneWidth);
  const [maxWidth, setMaxWidth] = useState(utilityPaneMaxWidth);
  const [contentRowWidth, setContentRowWidth] = useState(0);

  useEffect(() => {
    const node = contentRowRef.current;
    if (!node) return;
    const update = () => {
      const available = Math.round(node.getBoundingClientRect().width);
      setContentRowWidth(available);
      setMaxWidth(utilityPaneMaxWidth(available));
      setWidth((current) => clampUtilityPane(current, available));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [contentRowRef]);

  const persistWidth = useCallback(
    (nextWidth: number) => {
      const next = clampUtilityPane(nextWidth, contentRowWidth || undefined);
      setWidth(next);
      try {
        localStorage.setItem(UTILITY_PANE_WIDTH_STORAGE_KEY, String(next));
      } catch {
        /* ignore */
      }
    },
    [contentRowWidth],
  );

  return { width, minWidth: UTILITY_PANE_MIN, maxWidth, contentRowWidth, setWidth, persistWidth };
}

function initialUtilityPaneWidth(): number {
  if (typeof window === 'undefined') return UTILITY_PANE_DEFAULT;
  try {
    const stored = Number(
      localStorage.getItem(UTILITY_PANE_WIDTH_STORAGE_KEY) ??
        localStorage.getItem('droid-browser-pane-width'),
    );
    if (Number.isFinite(stored) && stored > 0) return clampUtilityPane(stored);
  } catch {
    /* ignore */
  }
  return clampUtilityPane(Math.min(UTILITY_PANE_DEFAULT, Math.round(window.innerWidth * 0.42)));
}

function utilityPaneMaxWidth(availableWidth?: number): number {
  if (typeof window === 'undefined') return UTILITY_PANE_MAX;
  const available = availableWidth ?? window.innerWidth;
  return Math.max(
    UTILITY_PANE_MIN,
    Math.min(UTILITY_PANE_MAX, Math.round(available - UTILITY_PANE_CONTENT_RESERVE)),
  );
}

function clampUtilityPane(width: number, availableWidth?: number): number {
  return Math.min(
    utilityPaneMaxWidth(availableWidth),
    Math.max(UTILITY_PANE_MIN, Math.round(width)),
  );
}
