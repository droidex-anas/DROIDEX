// The one Prism theme the app highlights code with, in theme tokens so it
// follows light and dark. Every surface that shows source — the files pane
// preview, the Canvas source editor — reads this, so code never looks like two
// different products.

import type { PrismTheme } from 'prism-react-renderer';

/** Past this many characters a surface shows plain text instead. */
export const HIGHLIGHT_CHAR_LIMIT = 120_000;

export const CODE_THEME: PrismTheme = {
  plain: { color: 'var(--droid-text-secondary)' },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: { color: 'var(--droid-text-muted)' },
    },
    {
      types: ['property', 'tag', 'boolean', 'number', 'constant', 'symbol', 'deleted'],
      style: { color: 'var(--droid-red)' },
    },
    {
      types: ['selector', 'attr-name', 'string', 'char', 'builtin', 'inserted'],
      style: { color: 'var(--droid-green)' },
    },
    {
      types: ['operator', 'entity', 'url', 'string-variable'],
      style: { color: 'var(--droid-text-secondary)' },
    },
    {
      types: ['atrule', 'attr-value', 'keyword'],
      style: { color: 'var(--droid-orange)' },
    },
    { types: ['function', 'class-name'], style: { color: 'var(--droid-accent)' } },
    { types: ['regex', 'important', 'variable'], style: { color: 'var(--droid-orange)' } },
  ],
};
