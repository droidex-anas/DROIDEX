import type { SourceFiles } from './schema.js';

type RelativeResolution =
  | { kind: 'file'; path: string }
  | { kind: 'missing' }
  | { kind: 'escapes' };

/** Walks a relative specifier inside `tree`, refusing to climb above its root. */
export function resolveRelative(
  tree: SourceFiles,
  importer: string,
  specifier: string,
): RelativeResolution {
  const segments = importer.includes('/')
    ? importer.slice(0, importer.lastIndexOf('/')).split('/')
    : [];
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return { kind: 'escapes' };
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const base = segments.join('/');
  const candidates = base
    ? [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]
    : ['index.tsx', 'index.ts'];
  const found = candidates.find((candidate) => Object.hasOwn(tree, candidate));
  return found === undefined ? { kind: 'missing' } : { kind: 'file', path: found };
}
