import { useEffect, useRef, useState } from 'react';
import { Download } from '@droidex/icons';
import { useStoreSelector } from '../hooks/useStore';
import { requestAppUpdate, useAppUpdate } from '../lib/appUpdate';
import { hasActiveSessionWork } from '../lib/sessions';

export function SidebarAppUpdateButton() {
  const { update, downloading } = useAppUpdate();
  const hasActiveWork = useStoreSelector(hasActiveSessionWork);
  return (
    <AppUpdateButtonView
      latest={update?.updateAvailable ? update.latest : null}
      downloading={downloading}
      onStart={() => {
        void requestAppUpdate(update, hasActiveWork);
      }}
    />
  );
}

// The resting circle, and the room the label keeps on each side of the open
// pill. The open width is measured from the rendered label rather than guessed,
// so "Update" and "Downloading" each get an exact fit at any UI font size.
const RESTING_SIZE = 20;
const LABEL_INSET = 9;
// The label fades out before its text swaps, so the pill never shows the new
// word sliding in from the old one's position.
const LABEL_SWAP_MS = 90;

export function AppUpdateButtonView({
  latest,
  downloading,
  onStart,
}: {
  latest: string | null;
  downloading: boolean;
  onStart: () => void;
}) {
  const [pointerOver, setPointerOver] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [openWidth, setOpenWidth] = useState(RESTING_SIZE);
  const labelRef = useRef<HTMLSpanElement>(null);
  const swapTimer = useRef<number | null>(null);
  const label = downloading ? 'Downloading' : 'Update';

  useEffect(() => {
    const element = labelRef.current;
    if (element) setOpenWidth(Math.ceil(element.scrollWidth) + LABEL_INSET);
  }, [label]);

  useEffect(
    () => () => {
      if (swapTimer.current !== null) window.clearTimeout(swapTimer.current);
    },
    [],
  );

  if (!latest) return null;
  const actionLabel = downloading
    ? `Downloading DROIDEX ${latest} update`
    : `Review DROIDEX ${latest} update`;
  const open = downloading || pointerOver || keyboardFocus;
  return (
    <button
      type="button"
      onClick={() => {
        if (swapTimer.current !== null) return;
        setSwapping(true);
        swapTimer.current = window.setTimeout(() => {
          swapTimer.current = null;
          setSwapping(false);
          onStart();
        }, LABEL_SWAP_MS);
      }}
      onPointerEnter={() => {
        setPointerOver(true);
      }}
      onPointerLeave={() => {
        setPointerOver(false);
      }}
      onFocus={(event) => {
        setKeyboardFocus(event.currentTarget.matches(':focus-visible'));
      }}
      onBlur={() => {
        setKeyboardFocus(false);
      }}
      disabled={downloading}
      title={actionLabel}
      aria-label={actionLabel}
      aria-busy={downloading}
      data-open={open}
      data-swapping={swapping}
      style={{ width: open ? openWidth : RESTING_SIZE }}
      className="update-pill relative h-5 shrink-0 cursor-pointer overflow-hidden rounded-full bg-droid-update text-white enabled:hover:bg-droid-update-hover disabled:bg-droid-update-hover"
    >
      <span className="update-pill-icon absolute inset-0 grid place-items-center">
        <Download size={13} strokeWidth={2} />
      </span>
      <span
        ref={labelRef}
        className={`update-pill-label absolute inset-y-0 flex items-center whitespace-nowrap pr-[9px] text-[11px] font-semibold tracking-[0.01em] ${
          downloading ? 'left-[9px]' : 'right-0'
        }`}
      >
        {label}
      </span>
    </button>
  );
}
