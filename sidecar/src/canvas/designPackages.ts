// The packages a design or kit may import, each mapped to the file it resolves
// to: a package's ESM entry where it ships one, so esbuild can drop the exports
// a design never uses. canvasRuntime.ts checks every entry resolves inside the
// runtime at startup; tools/verifyCanvasRuntime.mjs mirrors this list.

// The primitives the radix-ui umbrella re-exports. shadcn/ui components written
// before the umbrella import them one package at a time, and both forms load
// the same staged files. Radix's internal packages (react-primitive,
// react-use-*) are not a public API, so they are listed out rather than matched
// by prefix.
const RADIX_PRIMITIVES = [
  'accessible-icon',
  'accordion',
  'alert-dialog',
  'aspect-ratio',
  'avatar',
  'checkbox',
  'collapsible',
  'context-menu',
  'dialog',
  'direction',
  'dropdown-menu',
  'form',
  'hover-card',
  'label',
  'menubar',
  'navigation-menu',
  'one-time-password-field',
  'password-toggle-field',
  'popover',
  'portal',
  'progress',
  'radio-group',
  'scroll-area',
  'select',
  'separator',
  'slider',
  'slot',
  'switch',
  'tabs',
  'toast',
  'toggle',
  'toggle-group',
  'toolbar',
  'tooltip',
  'visually-hidden',
];

const RADIX_PRIMITIVE_SPECIFIERS = new Set(
  RADIX_PRIMITIVES.map((name) => `@radix-ui/react-${name}`),
);

export const DESIGN_PACKAGE_ENTRIES: ReadonlyMap<string, string> = new Map([
  ['react', 'react'],
  ['react/jsx-runtime', 'react/jsx-runtime'],
  ['react-dom/client', 'react-dom/client'],
  ['lucide-react', 'lucide-react/dist/esm/lucide-react.js'],
  ['recharts', 'recharts/es6/index.js'],
  ['simple-icons', 'simple-icons/index.mjs'],
  ['radix-ui', 'radix-ui/dist/index.mjs'],
  ...[...RADIX_PRIMITIVE_SPECIFIERS].map((specifier): [string, string] => [
    specifier,
    `${specifier}/dist/index.mjs`,
  ]),
  ['@radix-ui/react-icons', '@radix-ui/react-icons/dist/react-icons.esm.js'],
  ['class-variance-authority', 'class-variance-authority/dist/index.mjs'],
  ['clsx', 'clsx/dist/clsx.mjs'],
  ['tailwind-merge', 'tailwind-merge/dist/bundle-mjs.mjs'],
]);

/** The allowlist as a diagnostic names it, with the Radix primitives as one pattern. */
export const DESIGN_PACKAGE_LIST = [...DESIGN_PACKAGE_ENTRIES.keys()]
  .filter((specifier) => !RADIX_PRIMITIVE_SPECIFIERS.has(specifier))
  .map((specifier) =>
    specifier === 'radix-ui' ? 'radix-ui, @radix-ui/react-<primitive>' : specifier,
  )
  .join(', ');

/** The npm package a specifier or a file inside one belongs to. */
export function packageName(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}
