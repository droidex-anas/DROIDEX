import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { FOCUSABLE_SELECTOR, wrapTabFocus } from '../../lib/focusTrap';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Crop, Download } from 'lucide-react';
import { useObscuresNativeSurfaces } from '../../hooks/useObscuresNativeSurfaces';
import { downloadImage } from '../media/downloadImage';
import { IMAGE_VIEWER_TRANSITION, imageViewerContentMotion } from '../media/imageViewerMotion';
import {
  ViewerCloseButton,
  ViewerToolbar,
  ViewerToolbarButton,
  ViewerToolbarDivider,
} from '../media/viewerChrome';
import type { AttachedImage } from '../../hooks/useImageAttachments';
import { displayedToNaturalRect, isFullImageRect, type CropRect } from '../../lib/images';
import { toast } from '../../lib/toast';
import { CropOverlay } from './CropOverlay';

/**
 * In-app viewer for an attached image: click a chip to inspect it full-size,
 * optionally drag a crop, or just close. Crop rects are drawn in displayed
 * pixels and handed to the parent as natural pixels via onCrop.
 */
export function ImageViewerModal(props: {
  image: AttachedImage;
  onCrop: (id: string, rect: CropRect) => Promise<void>;
  onClose: () => void;
}) {
  // Portalled for the same reason as ImageLightbox: an animated ancestor's
  // transform would otherwise become the containing block for `fixed`.
  return createPortal(<ImageViewerModalContent {...props} />, document.body);
}

function ImageViewerModalContent({
  image,
  onCrop,
  onClose,
}: {
  image: AttachedImage;
  onCrop: (id: string, rect: CropRect) => Promise<void>;
  onClose: () => void;
}) {
  const [cropping, setCropping] = useState(false);
  const [rect, setRect] = useState<CropRect | null>(null);
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // The browser pane's native view is painted above the DOM by the OS; hide it
  // while this covers the window, or it shows straight through the image.
  useObscuresNativeSurfaces();

  // Modal focus boundary: without it, keyboard and AT users keep reaching the
  // composer controls behind this full-screen overlay. Move focus inside on
  // open and hand it back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement;
    const dialog = dialogRef.current;
    if (dialog) {
      const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables.length > 0) focusables[0].focus();
      else dialog.focus();
    }
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // Keep Tab/Shift+Tab cycling inside the dialog while it is open. Focus on
  // the container itself (clicked non-focusable backdrop content focuses the
  // nearest tabindex ancestor) wraps to the edges instead of escaping.
  const trapTab = (e: ReactKeyboardEvent) => {
    wrapTabFocus(e, dialogRef.current);
  };

  const cancelCrop = () => {
    setCropping(false);
    setRect(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (cropping) {
        cancelCrop();
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [cropping, onClose]);

  const applyCrop = async () => {
    const img = imgRef.current;
    if (!rect || !img?.clientWidth || !img.clientHeight) return;
    // Sizes are read live at apply time so a window resize while the viewer is
    // open can't skew the displayed-to-natural mapping.
    const naturalRect = displayedToNaturalRect(
      rect,
      { width: img.clientWidth, height: img.clientHeight },
      { width: img.naturalWidth, height: img.naturalHeight },
    );
    setSaving(true);
    try {
      if (!isFullImageRect(naturalRect, { width: img.naturalWidth, height: img.naturalHeight }))
        await onCrop(image.id, naturalRect);
      setCropping(false);
      setRect(null);
    } catch {
      // Stay in crop mode so the selection isn't lost.
      toast.error('Could not save the crop');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      tabIndex={-1}
      onKeyDown={trapTab}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={IMAGE_VIEWER_TRANSITION}
      className="fixed inset-0 z-[1200] flex items-center justify-center overflow-hidden bg-black/75 px-8 pb-24 pt-16 backdrop-blur-md focus:outline-none"
      onClick={cropping ? undefined : onClose}
    >
      <motion.div
        {...imageViewerContentMotion(reduceMotion)}
        className="relative max-h-full"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <img
          ref={imgRef}
          src={image.preview}
          alt="Attached image preview"
          draggable={false}
          className="block max-h-[calc(100vh-10rem)] max-w-[calc(100vw-4rem)] select-none rounded-lg object-contain shadow-droid"
        />
        {cropping && <CropOverlay rect={rect} onChange={setRect} />}
      </motion.div>
      <ViewerCloseButton onClose={onClose} />
      <ViewerToolbar label="Image controls">
        {cropping ? (
          <>
            <span className="px-2.5 text-[12.5px] text-droid-text-muted">
              Drag to choose a crop
            </span>
            <ViewerToolbarDivider />
            <ViewerToolbarButton label="Cancel crop" onClick={cancelCrop}>
              Cancel
            </ViewerToolbarButton>
            <ViewerToolbarButton
              label="Apply crop"
              primary
              disabled={!rect || saving}
              onClick={() => void applyCrop()}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              <span className="pr-1">{saving ? 'Saving…' : 'Apply crop'}</span>
            </ViewerToolbarButton>
          </>
        ) : (
          <>
            <ViewerToolbarButton
              label="Crop"
              onClick={() => {
                setCropping(true);
              }}
            >
              <Crop className="h-4 w-4" />
              <span className="pr-1">Crop</span>
            </ViewerToolbarButton>
            <ViewerToolbarButton
              label="Download"
              onClick={() => void downloadImage(image.preview, image.path)}
            >
              <Download className="h-4 w-4" />
            </ViewerToolbarButton>
          </>
        )}
      </ViewerToolbar>
    </motion.div>
  );
}
