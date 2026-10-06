import { useEffect, useRef, useState, type RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Download, ImageOff, Minus, Plus } from 'lucide-react';
import { wrapTabFocus } from '../../lib/focusTrap';
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

  useEffect(() => {
    const opener = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Capture keys before the page behind the dialog can handle them.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
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
  }, [failed, onClose, reset, zoomBy]);

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
      className="fixed inset-0 z-[1200] bg-black/75 backdrop-blur-md focus:outline-none"
      onClick={onClose}
    >
      <div
        ref={stageRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden px-8 pb-24 pt-16"
      >
        {failed ? (
          <div
            className="flex max-w-[90vw] flex-col items-center gap-3 rounded-2xl bg-droid-raised px-6 py-5 text-droid-text-muted shadow-droid"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <ImageOff className="h-8 w-8" />
            <span className="max-w-full truncate text-[12px]">{label}</span>
            <span className="text-[12px]">Image is no longer available</span>
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
                  ? 'block h-[calc(100vh-10rem)] w-[calc(100vw-4rem)] select-none rounded-2xl bg-droid-bg object-contain p-10 shadow-droid'
                  : 'block max-h-[calc(100vh-10rem)] max-w-[calc(100vw-4rem)] select-none rounded-lg object-contain shadow-droid'
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
            <Minus className="h-4 w-4" />
          </ViewerToolbarButton>
          <ViewerToolbarButton label="Fit to window (0)" onClick={reset}>
            <span className="min-w-[3rem] text-center tabular-nums">
              {Math.round(zoom.scale * fitRatio * 100)}%
            </span>
          </ViewerToolbarButton>
          <ViewerToolbarButton
            label="Zoom in (+)"
            disabled={!zoom.canZoomIn}
            onClick={() => {
              zoomBy(ZOOM_STEP);
            }}
          >
            <Plus className="h-4 w-4" />
          </ViewerToolbarButton>
          <ViewerToolbarDivider />
          <ViewerToolbarButton
            label="Download"
            onClick={() => {
              void downloadImage(src, label);
            }}
          >
            <Download className="h-4 w-4" />
          </ViewerToolbarButton>
        </ViewerToolbar>
      )}
    </motion.div>
  );
}
