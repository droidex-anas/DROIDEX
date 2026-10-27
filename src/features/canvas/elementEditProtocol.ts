// Direct element edit DTOs, mirrored by hand from sidecar/src/canvas/schema.ts
// like the rest of protocol.ts; sidecar/src/canvas/schema.test.ts stops
// compiling when the two drift.

import type { ElementRef, WriteReceipt } from './protocol';

export type StyleKind = 'spacing' | 'size' | 'colour' | 'typography' | 'layout' | 'opacity';

/** A kit token's name (`--ds-space-2`) or a raw CSS value for one style property. */
export type StyleChange =
  | { kind: 'spacing'; property: string; value: string }
  | { kind: 'size'; property: string; value: string }
  | { kind: 'colour'; property: string; value: string }
  | { kind: 'typography'; property: string; value: string }
  | { kind: 'layout'; property: string; value: string }
  | { kind: 'opacity'; property: string; value: string };

export interface EditElementInput {
  mutationId: string;
  edit: {
    element: ElementRef;
    change: { kind: 'text'; value: string } | StyleChange | { kind: 'image'; assetId: string };
  };
}

/** What a style edit wrote: a kit token, or the raw value the kit had no token for. */
export type StyleResolution = { kind: 'token'; token: string } | { kind: 'raw'; value: string };

/** A direct edit's revision and what its style value resolved to; null for a text edit. */
export interface ElementEditResult {
  receipt: WriteReceipt;
  resolution: StyleResolution | null;
}
