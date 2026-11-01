// The Typography section's specimen (spec §5): the type tokens of what the
// previews build from, each on one line of sample text the kit renders, since
// its fonts load only inside preview guests. The sidecar's `typographySpecimen`
// lays it out.

import type { DocumentSection, DocumentToken } from '../designSystemDocumentProtocol';
import { KitPreviewTile, type KitPreviewing } from './KitPreviewTile';

const SPECIMEN_WIDTH = 960;
// A capture is at most 4096 device pixels tall, which is 2048 CSS px at 2x.
const MAX_SPECIMEN_HEIGHT = 2048;

// The specimen's layout: page padding, gaps, and a group title's line.
const PAGE_PADDING_PX = 32;
const GROUP_GAP_PX = 32;
const ROW_GAP_PX = 16;
const GROUP_TITLE_PX = 16;
// A line of the guest's 16 px text, and the line a value no length describes may take.
const BASE_LINE_PX = 24;
const UNKNOWN_LINE_PX = 48;

export interface TypeSpecimenSize {
  width: number;
  height: number;
}

/**
 * The specimen's size, tall enough for every token's line, or null when the
 * version has no typography tokens and so no specimen to run.
 */
export function typeSpecimenSize(sections: readonly DocumentSection[]): TypeSpecimenSize | null {
  const groups: DocumentToken[][] = [];
  for (const section of sections) {
    if (section.kind !== 'typography') continue;
    for (const item of section.items) if (item.kind === 'group') groups.push(item.tokens);
  }
  if (groups.length === 0) return null;
  let height = PAGE_PADDING_PX * 2 + GROUP_GAP_PX * (groups.length - 1);
  for (const tokens of groups) {
    height += GROUP_TITLE_PX;
    for (const token of tokens) height += ROW_GAP_PX + lineHeightPx(token);
  }
  return { width: SPECIMEN_WIDTH, height: Math.min(MAX_SPECIMEN_HEIGHT, Math.ceil(height)) };
}

/** The taller of the token's lines in either mode, so switching modes does not resize the tile. */
function lineHeightPx(token: DocumentToken): number {
  const values = 'value' in token ? [token.value] : [token.light, token.dark];
  return Math.max(...values.map(valueLinePx));
}

// The specimen sets each token on its own property; without knowing which, a
// length reads as a font size, a small plain number as a line height, and
// anything else (a family, a weight, a tracking) leaves the base line.
function valueLinePx(raw: string): number {
  const value = raw.trim();
  const match = /^(\d*\.?\d+)(px|r?em|)$/.exec(value);
  // A clamp(), a viewport unit or a percentage may be any size.
  if (!match) return /^[\d.]|\(/.test(value) ? UNKNOWN_LINE_PX : BASE_LINE_PX;
  const [, amountText, unit] = match;
  const amount = Number(amountText);
  if (unit === '') return amount <= 4 ? Math.max(BASE_LINE_PX, amount * 16) : BASE_LINE_PX;
  const sizePx = unit === 'px' ? amount : amount * 16;
  return Math.max(BASE_LINE_PX, sizePx * 1.3);
}

export function TypeSpecimen({
  size,
  previewing,
}: {
  size: TypeSpecimenSize;
  previewing: KitPreviewing;
}) {
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex min-h-control-md items-center">
        <span className="truncate text-body-strong text-primary">Specimen</span>
      </figcaption>
      <KitPreviewTile
        previewing={previewing}
        item="typography"
        label="Typography specimen"
        width={size.width}
        height={size.height}
        placeholder={
          <span className="flex size-full items-center justify-center text-label text-muted">
            Specimen
          </span>
        }
      />
    </figure>
  );
}
