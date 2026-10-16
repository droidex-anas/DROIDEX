import type { PrismTheme } from 'prism-react-renderer';

export const CODE_THEME: PrismTheme = {
  plain: { color: 'var(--text-secondary)' },
  styles: [
    {
      types: ['comment', 'prolog', 'doctype', 'cdata'],
      style: { color: 'var(--text-muted)' },
    },
    {
      types: ['property', 'tag', 'boolean', 'number', 'constant', 'symbol', 'deleted'],
      style: { color: 'var(--danger)' },
    },
    {
      types: ['selector', 'attr-name', 'string', 'char', 'builtin', 'inserted'],
      style: { color: 'var(--success)' },
    },
    {
      types: ['operator', 'entity', 'url', 'string-variable'],
      style: { color: 'var(--text-secondary)' },
    },
    {
      types: ['atrule', 'attr-value', 'keyword'],
      style: { color: 'var(--warning)' },
    },
    { types: ['function', 'class-name'], style: { color: 'var(--accent)' } },
    { types: ['regex', 'important', 'variable'], style: { color: 'var(--warning)' } },
  ],
};
