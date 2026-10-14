import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Download, ImageOff, Minus, Plus } from '@droidex/icons';
import { wrapTabFocus } from '../../lib/focusTrap';
import { pushEscapeLayer } from '../ui/escapeStack';
import { downloadImage } from './downloadImage';
import { IMAGE_VIEWER_TRANSITION, imageViewerContentMotion } from './imageViewerMotion';
import { useZoomPan, ZOOM_STEP } from './useZoomPan';
import {
  ViewerCloseButton,
  ViewerToolbar,
  ViewerToolbarButton,
  ViewerToolbarDivider,
} from './viewerChrome';

export interface ImageLightboxProps {
  src: string;
  label: string;
  // A diagram has no pixel size worth keeping, so it grows to fill the view on
  // a canvas of its own instead of floating, transparent, over the backdrop.
  vector?: boolean;
  onClose: () => void;
}

// Zoom tops out at eight screen pixels per image pixel.
const MAX_PIXEL_ZOOM = 8;

// The fitted image's drawn width over its pixel width, so the zoom readout says
// 100% at actual size rather than at fit. Re-measured as the window resizes.
function useFitRatio(imageRef: RefObject<HTMLImageElement | null>, enabled: boolean): number {
  const [ratio, setRatio] = useState(1);
  useEffect(() => {
    const image = imageRef.current;
    if (!image || !enabled) return;
    const observer = new ResizeObserver(() => {
      if (image.naturalWidth > 0) setRatio(image.clientWidth / image.naturalWidth);
    });
    observer.observe(image);
    return () => {
      observer.disconnect();
    };
  }, [enabled, imageRef]);
  return enabled ? ratio : 1;
}

export function ImageLightboxContent({ src, label, vector = false, onClose }: ImageLightboxProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  const reduceMotion = useReducedMotion();
  // A diagram has no pixel size, so its readout stays relative to the fit.
  const fitRatio = useFitRatio(imageRef, !vector && !failed);
  const zoom = useZoomPan({
    stageRef,
    contentRef,
    enabled: !failed,
    maxScale: MAX_PIXEL_ZOOM / fitRatio,
  });
  const { zoomBy, reset } = zoom;
  const zoomPercent = String(Math.round(zoom.scale * fitRatio * 100));

  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Escape closes only the topmost layer: a spec behind this viewer stays
  // open, and the viewer's unmount returns focus to the image inside it. The
  // layer is pushed once per mount so a caller's new `onClose` on a rerender
  // does not move it above a later layer such as a focused toast.
  const close = useEffectEvent(onClose);
  useEffect(
    () =>
      pushEscapeLayer(() => {
        close();
      }),
    [],
  );

  // Capture keys before the page behind the dialog can handle them.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!failed && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        zoomBy(ZOOM_STEP);
        return;
      }
      if (!failed && e.key === '-') {
        e.preventDefault();
        zoomBy(1 / ZOOM_STEP);
        return;
      }
      if (!failed && e.key === '0') {
        e.preventDefault();
        reset();
        return;
      }
      wrapTabFocus(e, dialogRef.current);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [failed, reset, zoomBy]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Image: ${label}`}
      tabIndex={-1}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={IMAGE_VIEWER_TRANSITION}
      className="fixed inset-0 z-dialog bg-bg/60 focus:outline-none"
      onClick={onClose}
    >
      <div
        ref={stageRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden px-8 pb-24 pt-16"
      >
        {failed ? (
          <div
            className="flex max-w-[90vw] flex-col items-center gap-3 rounded-xl bg-raised px-6 py-5 text-muted shadow-lg"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <ImageOff className="size-icon-lg" />
            <span className="max-w-full truncate text-label text-secondary">{label}</span>
            <span className="text-body-lg">Image is no longer available</span>
          </div>
        ) : (
          <div
            ref={contentRef}
            {...zoom.contentHandlers}
            className={`touch-none ${zoom.contentCursor}`}
            style={zoom.contentStyle}
            onClick={(e) => {
              e.stopPropagation();
            }}
            onDoubleClick={(e) => {
              zoom.toggleAt(e.clientX, e.clientY);
            }}
          >
            <motion.img
              ref={imageRef}
              src={src}
              alt={label}
              draggable={false}
              {...imageViewerContentMotion(reduceMotion)}
              className={
                vector
                  ? 'block h-[calc(100vh-10rem)] w-[calc(100vw-4rem)] select-none rounded-xl bg-bg object-contain p-10 shadow-lg'
                  : 'block max-h-[calc(100vh-10rem)] max-w-[calc(100vw-4rem)] select-none rounded-md object-contain shadow-lg'
              }
              onError={() => {
                setFailed(true);
              }}
            />
          </div>
        )}
      </div>
      <ViewerCloseButton onClose={onClose} />
      {!failed && (
        <ViewerToolbar label="Image controls">
          <ViewerToolbarButton
            label="Zoom out (−)"
            disabled={!zoom.canZoomOut}
            onClick={() => {
              zoomBy(1 / ZOOM_STEP);
            }}
          >
            <Minus className="size-icon-md" />
          </ViewerToolbarButton>
          <ViewerToolbarButton label={`Zoom ${zoomPercent}%, fit to window (0)`} onClick={reset}>
            <span className="min-w-12 text-center tabular-nums">{zoomPercent}%</span>
          </ViewerToolbarButton>
          <ViewerToolbarButton
            label="Zoom in (+)"
            disabled={!zoom.canZoomIn}
            onClick={() => {
              zoomBy(ZOOM_STEP);
            }}
          >
            <Plus className="size-icon-md" />
          </ViewerToolbarButton>
          <ViewerToolbarDivider />
          <ViewerToolbarButton
            label="Download"
            onClick={() => {
              void downloadImage(src, label);
            }}
          >
            <Download className="size-icon-md" />
          </ViewerToolbarButton>
        </ViewerToolbar>
      )}
    </motion.div>
  );
}
