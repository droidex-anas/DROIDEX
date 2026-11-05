// Direct element edit DTOs, mirrored by hand from sidecar/src/canvas/schema.ts
// like the rest of protocol.ts; sidecar/src/canvas/schema.test.ts stops
// compiling when the two drift.

import type { ElementRef } from './protocol';

/** One property's new value: a kit token's name (`--ds-space-2`) or a raw CSS value. */
export interface StyleValue {
  property: string;
  value: string;
}

export interface EditElementInput {
  mutationId: string;
  edit: {
    element: ElementRef;
    change:
      | { kind: 'text'; value: string }
      | { kind: 'style'; styles: StyleValue[] }
      | { kind: 'image'; assetId: string };
  };
}
