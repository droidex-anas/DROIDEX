// A small design system document on the starter's token values, shared by the
// sidecar's and the renderer's tests of the document contract.

import type { DocumentSection } from '../canvas/designSystemDocument.js';

export const DROIDEX_DOCUMENT_SECTIONS: DocumentSection[] = [
  {
    kind: 'notes',
    id: 'overview',
    title: 'Overview',
    items: [
      {
        kind: 'note',
        id: 'rules',
        label: '1-rules.md',
        body: 'Separate with tone and space, not lines. One primary action per view.',
        author: 'user',
      },
      {
        kind: 'preview',
        id: 'settings',
        title: 'Settings panel',
        example: 'Settings.tsx',
        width: 960,
        height: 640,
      },
    ],
  },
  {
    kind: 'colors',
    id: 'colors',
    title: 'Colors',
    items: [
      {
        kind: 'group',
        id: 'surfaces',
        title: 'Surfaces',
        tokens: [
          { name: '--ds-canvas', light: '#f6f3ee', dark: '#121110' },
          {
            name: '--ds-surface',
            light: '#fdfbf7',
            dark: '#191817',
            note: 'The reading area of a window.',
          },
        ],
      },
      {
        kind: 'group',
        id: 'accent',
        title: 'Accent',
        tokens: [{ name: '--ds-accent', light: '#8a5a1f', dark: '#e3a857' }],
      },
    ],
  },
  {
    kind: 'shadows',
    id: 'shadows',
    title: 'Shadows',
    items: [
      {
        kind: 'group',
        id: 'elevation',
        title: 'Elevation',
        tokens: [
          {
            name: '--ds-shadow-md',
            light: '0 12px 32px rgb(34 30 25 / 0.10)',
            dark: '0 16px 44px rgb(0 0 0 / 0.50)',
          },
        ],
      },
    ],
  },
  {
    kind: 'components',
    id: 'components',
    title: 'Components',
    items: [
      {
        kind: 'note',
        id: 'button-api',
        label: 'button.md',
        body: '`<Button variant="primary">` for the one action that finishes the view.',
        author: 'agent',
      },
      {
        kind: 'preview',
        id: 'button',
        title: 'Button',
        example: 'Button.tsx',
        width: 480,
        height: 200,
        note: 'Primary, secondary and ghost, at rest and pressed.',
      },
    ],
  },
];
