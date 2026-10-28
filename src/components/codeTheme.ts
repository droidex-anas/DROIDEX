// The one Prism theme the app highlights code with, in the theme's code tokens
// (`codeColors` in themeTokens.ts) so it follows light and dark. Every surface
// that shows source (the files pane preview, the Canvas source editor, fenced
// code in the transcript) reads this, so code never looks like two products.

import type { PrismTheme } from 'prism-react-renderer';

/** Past this many characters a surface shows plain text instead. */
export const HIGHLIGHT_CHAR_LIMIT = 120_000;

export const CODE_THEME: PrismTheme = {
  plain: { color: 'var(--text-secondary)' },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata', 'punctuation'],
      style: { color: 'var(--code-comment)' },
    },
    {
      types: ['keyword', 'atrule', 'important', 'selector'],
      style: { color: 'var(--code-keyword)' },
    },
    {
      types: ['string', 'char', 'attr-value', 'regex', 'url', 'inserted'],
      style: { color: 'var(--code-string)' },
    },
    {
      types: ['number', 'boolean', 'constant', 'symbol', 'deleted'],
      style: { color: 'var(--code-number)' },
    },
    {
      types: ['function', 'class-name', 'tag', 'property', 'builtin'],
      style: { color: 'var(--code-function)' },
    },
  ],
};
