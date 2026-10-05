import { useState } from 'react';
import { ImageOff, MousePointer2, PenLine } from 'lucide-react';
import type { BrowserTranscriptReference } from '../../types/bridge';
import { ImageLightbox } from '../media/ImageLightbox';

export function BrowserReferenceChip({ reference }: { reference: BrowserTranscriptReference }) {
  const Icon = reference.kind === 'element' ? MousePointer2 : PenLine;
  const [open, setOpen] = useState(false);
  const [failedThumbnailSrc, setFailedThumbnailSrc] = useState<string | null>(null);
  const title = reference.selector
    ? `${reference.selector}\n${reference.url ?? ''}`
    : (reference.url ?? `Design reference: ${reference.label}`);
  const label = `@${reference.label}`;

  if (reference.imageDataUrl) {
    const thumbnailFailed = failedThumbnailSrc === reference.imageDataUrl;

    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          title={`View ${label}`}
          className="flex min-w-0 items-center gap-1.5 rounded-lg bg-droid-accent/15 px-2 py-1 text-[11px] font-medium text-droid-text ring-1 ring-inset ring-droid-accent/30 transition-colors hover:bg-droid-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/50"
        >
          {thumbnailFailed ? (
            <ImageOff className="h-3 w-3 shrink-0 text-droid-accent" />
          ) : (
            <img
              src={reference.imageDataUrl}
              alt=""
              className="h-5 max-w-12 rounded-sm object-cover"
              onError={() => {
                setFailedThumbnailSrc(reference.imageDataUrl ?? null);
              }}
            />
          )}
          <span className="max-w-40 truncate">{label}</span>
        </button>
        {open && (
          <ImageLightbox
            src={reference.imageDataUrl}
            label={title}
            onClose={() => {
              setOpen(false);
            }}
          />
        )}
      </>
    );
  }

  return (
    <span
      title={title}
      className="flex min-w-0 items-center gap-1.5 rounded-lg bg-droid-accent/15 px-2 py-1 text-[11px] font-medium text-droid-text ring-1 ring-inset ring-droid-accent/30"
    >
      <Icon className="h-3 w-3 shrink-0 text-droid-accent" />
      <span className="max-w-40 truncate">{label}</span>
    </span>
  );
}
