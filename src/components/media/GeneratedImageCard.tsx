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
  error = false,
  running = false,
}: {
  event: TranscriptEvent;
  output?: string;
  error?: boolean;
  running?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const prompt = toolArgString(event.toolArgs, 'prompt') ?? '';
  const src = running ? null : imageSrc(output?.trim() ?? '');
  const label = prompt || 'Generated image';

  if (src === null) {
    return (
      <div
        className="my-1.5 flex aspect-square w-[360px] max-w-full items-center justify-center overflow-hidden rounded-2xl bg-droid-elevated"
        title={label}
        aria-label={running ? `Generating ${label}` : label}
      >
        {running ? (
          <GeneratingGrid />
        ) : (
          <span className="px-6 text-center text-[12.5px] text-droid-text-muted">
            {error && output ? output.trim() : 'No image was generated.'}
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
        <img src={src} alt={label} draggable={false} className="h-full w-full object-contain" />
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
