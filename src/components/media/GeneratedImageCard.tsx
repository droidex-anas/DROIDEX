import { useState } from 'react';
import type { TranscriptEvent } from '../../types/bridge';
import { imageSrc } from '../../lib/localImage';
import { toolArgString } from '../../lib/tools';
import { ImageLightbox } from './ImageLightbox';

/**
 * An image the agent generated, as one square card in the assistant's column.
 * The card is the same size and shape in all three states, so the transcript
 * does not move when the image lands: while it is being made the square carries
 * a dot grid that brightens along a slow diagonal, and afterwards it carries the
 * image itself. A run that produced no image keeps the square and says why.
 */
export function GeneratedImageCard({
  event,
  output,
  running = false,
}: {
  event: TranscriptEvent;
  // The saved image's path, or the reason there is none. A provider failure and
  // a result that is not a loadable image both read as the line to show.
  output?: string;
  running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Keyed by src: a card that failed to load one file must not stay failed when
  // a later render points it at another.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const prompt = toolArgString(event.toolArgs, 'prompt') ?? '';
  const text = output?.trim() ?? '';
  const src = running ? null : imageSrc(text);
  const label = prompt || 'Generated image';

  if (src === null || failedSrc === src) {
    return (
      <div
        className="my-1.5 flex aspect-square w-[360px] max-w-full items-center justify-center overflow-hidden rounded-2xl bg-droid-elevated"
        title={label}
        {...(running
          ? { role: 'status', 'aria-label': `Generating ${label}` }
          : { 'aria-label': label })}
      >
        {running ? (
          <GeneratingGrid />
        ) : (
          <span className="px-6 text-center text-[12.5px] text-droid-text-muted">
            {failureText(text, failedSrc === src)}
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <button
        onClick={() => {
          setOpen(true);
        }}
        title={`View ${label}`}
        className="my-1.5 block aspect-square w-[360px] max-w-full overflow-hidden rounded-2xl bg-droid-elevated"
      >
        <img
          src={src}
          alt={label}
          draggable={false}
          className="h-full w-full object-contain"
          onError={() => {
            setFailedSrc(src);
          }}
        />
      </button>
      {open && (
        <ImageLightbox
          src={src}
          label={label}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

// Whatever the run can say for itself: a file that will not load names itself,
// then the producer's own reason, and only then a bare statement.
function failureText(text: string, unreadable: boolean): string {
  if (unreadable) return `This image could not be opened: ${text}`;
  return text || 'No image was generated.';
}

// Two layers: a dim grid across the whole square, and the same grid used as a
// mask over a diagonal band that drifts, so the dots themselves brighten in a
// slow sweep rather than a highlight sliding over the surface.
function GeneratingGrid() {
  return (
    <div className="relative h-full w-full" aria-hidden>
      <div className="image-grid-dots absolute inset-0" />
      <div className="image-grid-mask absolute inset-0 overflow-hidden">
        <div className="image-grid-sweep absolute -inset-1/2" />
      </div>
    </div>
  );
}
