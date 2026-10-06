import { lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import type { ImageLightboxProps } from './ImageLightboxContent';

// Zoom, pan and saving load with the first opened image, not with the transcript.
const ImageLightboxContent = lazy(() =>
  import('./ImageLightboxContent').then((m) => ({ default: m.ImageLightboxContent })),
);

/**
 * Read-only full-view for a single image: click a transcript thumbnail to
 * inspect it, zoom and pan, download it, then Escape or a backdrop click to
 * leave. The composer's ImageViewerModal stays separate because it owns
 * cropping of a staged attachment; this one only displays.
 *
 * Portalled to the body like every other overlay in the app: the thumbnails
 * that open it live inside animated (transformed) transcript rows, and a
 * transformed ancestor becomes the containing block for `position: fixed`, so
 * rendering in place would pin the overlay inside a chat bubble.
 */
export function ImageLightbox(props: ImageLightboxProps) {
  return createPortal(
    <Suspense fallback={null}>
      {/* Keyed by src: another image starts from a fresh view, not the last one's zoom. */}
      <ImageLightboxContent key={props.src} {...props} />
    </Suspense>,
    document.body,
  );
}
