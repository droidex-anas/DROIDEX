// The style properties a direct edit may set and the kind each is sent as,
// mirrored from STYLE_PROPERTIES in sidecar/src/canvas/styleEdits.ts, which
// owns their values; sidecar/src/canvas/schema.test.ts fails when they drift.

import type { StyleKind } from './elementEditProtocol';

export const STYLE_PROPERTIES: Readonly<Record<string, StyleKind>> = {
  padding: 'spacing',
  paddingTop: 'spacing',
  paddingRight: 'spacing',
  paddingBottom: 'spacing',
  paddingLeft: 'spacing',
  margin: 'spacing',
  marginTop: 'spacing',
  marginRight: 'spacing',
  marginBottom: 'spacing',
  marginLeft: 'spacing',
  gap: 'spacing',
  rowGap: 'spacing',
  columnGap: 'spacing',
  width: 'size',
  height: 'size',
  minWidth: 'size',
  minHeight: 'size',
  maxWidth: 'size',
  maxHeight: 'size',
  borderRadius: 'size',
  color: 'colour',
  backgroundColor: 'colour',
  borderColor: 'colour',
  fontSize: 'typography',
  fontWeight: 'typography',
  lineHeight: 'typography',
  letterSpacing: 'typography',
  flexDirection: 'layout',
  alignItems: 'layout',
  justifyContent: 'layout',
  opacity: 'opacity',
};

export function styleKind(property: string): StyleKind | null {
  return Object.hasOwn(STYLE_PROPERTIES, property) ? (STYLE_PROPERTIES[property] ?? null) : null;
}
