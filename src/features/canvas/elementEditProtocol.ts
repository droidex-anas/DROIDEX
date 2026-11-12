// Direct element edit DTOs, mirrored by hand from sidecar/src/canvas/schema.ts
// like the rest of protocol.ts; sidecar/src/canvas/schema.test.ts stops
// compiling when the two drift.

import type { ElementRef, WriteReceipt } from './protocol';

/** One property's new value: a kit token's name (`--ds-space-2`) or a raw CSS value. */
export interface StyleValue {
  property: string;
  value: string;
}

export interface EditElementInput {
  mutationId: string;
  edit:
    | {
        element: ElementRef;
        change:
          | { kind: 'text'; value: string }
          | { kind: 'style'; styles: StyleValue[] }
          | { kind: 'image'; assetId: string }
          /** A literal `<path>`'s `d`, as SVG path data separated by spaces and commas only. */
          | { kind: 'path'; d: string };
      }
    | {
        layer: LayerRef;
        change: LayerChange;
      };
}

/** A row of a frame's revision's outline, as a layer edit names it. */
export interface LayerRef {
  designId: string;
  revisionId: string;
  nodeId: string;
}

export type LayerChange =
  /** Into the element row `parentId`, before its child row `beforeId`, or last for null. */
  | { kind: 'move'; parentId: string; beforeId: string | null }
  | { kind: 'remove' }
  /** A copy right after the layer. */
  | { kind: 'duplicate' }
  /** The element given Tailwind's `hidden` class, or without it to show again. */
  | { kind: 'hide'; hidden: boolean };

/** An edit's revision, and the nodeId of the row a layer edit lands on in it (the moved layer, its copy, or the row a removed one leaves the keyboard to); null for any other edit, or a replay. */
export interface ElementEdited {
  receipt: WriteReceipt;
  landed: string | null;
}
