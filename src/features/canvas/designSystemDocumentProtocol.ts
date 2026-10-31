// Design system document DTOs, mirrored by hand from
// sidecar/src/canvas/designSystemDocument.ts; designSystemDocument.test.ts there
// stops compiling when the two drift.

export type TokenKind =
  | 'colors'
  | 'typography'
  | 'spacing'
  | 'radius'
  | 'shadows'
  | 'motion'
  | 'tokens';

/** Markdown the agent reads as one of the kit's rules, labelled like a file. */
export interface DocumentNote {
  kind: 'note';
  id: string;
  label: string;
  body: string;
  /** Who last changed it, set by the sidecar from who saved. */
  author: 'user' | 'agent';
}

/** One value for both modes, or a value for each. */
export type DocumentToken =
  | { name: string; note?: string; value: string }
  | { name: string; note?: string; light: string; dark: string };

export interface TokenGroup {
  kind: 'group';
  id: string;
  title: string;
  tokens: DocumentToken[];
}

/** An example file rendered with the kit at this size in CSS pixels. */
export interface DocumentPreview {
  kind: 'preview';
  id: string;
  title: string;
  example: string;
  width: number;
  height: number;
  note?: string;
}

export interface DocumentAsset {
  kind: 'asset';
  id: string;
  name: string;
  assetId: string;
  note?: string;
}

/** One section of the document; the order of the array is the reading order. */
export type DocumentSection =
  | { kind: 'notes'; id: string; title: string; items: (DocumentNote | DocumentPreview)[] }
  | { kind: TokenKind; id: string; title: string; items: (DocumentNote | TokenGroup)[] }
  | { kind: 'components'; id: string; title: string; items: (DocumentNote | DocumentPreview)[] }
  | { kind: 'assets'; id: string; title: string; items: (DocumentNote | DocumentAsset)[] };
