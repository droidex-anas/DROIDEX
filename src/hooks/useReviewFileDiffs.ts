import { useCallback, useRef, useState } from 'react';
import { getGitFileDiff } from '../lib/git';
import type { DiffScope } from '../types/vcs';

export interface FileDiffEntry {
  diff: string;
  binary: boolean;
  status: 'loading' | 'loaded' | 'failed';
}

export interface ReviewFileDiffs {
  entries: Partial<Record<string, FileDiffEntry>>;
  ensure: (path: string) => void;
}

// Hard changes clear the cache; content changes invalidate only that file,
// preserving its loaded patch during revalidation. Generations reject late work.
export function useReviewFileDiffs(
  cwd: string,
  scope: DiffScope,
  ignoreWhitespace: boolean,
  fileSignatures: ReadonlyMap<string, string>,
  appSessionId?: string,
): ReviewFileDiffs {
  const [entries, setEntries] = useState<ReviewFileDiffs['entries']>({});
  // A Map avoids the Object.prototype lookup collision that lets a file path
  // like `__proto__` or `constructor` bypass the cache check
  // (`status.current['__proto__']` returns the prototype, which is truthy),
  // causing expanded sections to refetch their diff on every render.
  const status = useRef<Map<string, 'loading' | 'loaded'>>(new Map());
  const gen = useRef(0);
  const fileGen = useRef<Map<string, number>>(new Map());

  const hardKey = `${cwd}\u0000${scope}\u0000${ignoreWhitespace}\u0000${appSessionId ?? ''}`;
  const hardRef = useRef(hardKey);
  const sigRef = useRef(fileSignatures);

  // Adjust cache state during render (the supported React pattern for resetting
  // when inputs change) so a fresh generation is in effect before any effect
  // calls ensure() this commit.
  if (hardRef.current !== hardKey) {
    hardRef.current = hardKey;
    sigRef.current = fileSignatures;
    status.current.clear();
    fileGen.current.clear();
    gen.current += 1;
    setEntries({});
  } else if (sigRef.current !== fileSignatures) {
    const prev = sigRef.current;
    sigRef.current = fileSignatures;
    // Keep existing entries visible; ensure() refetches and overwrites in
    // place. Files whose line vanished also drop their status so a later
    // reappearance refetches instead of serving the stale diff.
    for (const path of status.current.keys()) {
      if (fileSignatures.get(path) !== prev.get(path)) {
        status.current.delete(path);
        fileGen.current.set(path, (fileGen.current.get(path) ?? 0) + 1);
      }
    }
  }

  const ensure = useCallback(
    (path: string) => {
      if (status.current.has(path)) return;
      status.current.set(path, 'loading');
      const requestGen = gen.current;
      const requestFileGen = fileGen.current.get(path) ?? 0;
      const stale = () =>
        gen.current !== requestGen || (fileGen.current.get(path) ?? 0) !== requestFileGen;
      const fail = () => {
        if (stale()) return;
        status.current.delete(path);
        setEntries((cur) =>
          cur[path]?.status === 'loaded'
            ? cur
            : {
                ...cur,
                [path]: { diff: '', binary: false, status: 'failed' },
              },
        );
      };
      setEntries((cur) => {
        const prev = cur[path];
        if (prev?.status === 'loaded') return cur;
        return {
          ...cur,
          [path]: {
            diff: '',
            binary: false,
            status: 'loading',
          },
        };
      });
      getGitFileDiff(cwd, scope, path, ignoreWhitespace, appSessionId)
        .then((res) => {
          if (stale()) return;
          if (res.error) {
            fail();
            return;
          }
          status.current.set(path, 'loaded');
          setEntries((cur) => {
            const prev = cur[path];
            if (prev?.status === 'loaded' && prev.diff === res.diff && prev.binary === res.binary) {
              return cur;
            }
            return {
              ...cur,
              [path]: { diff: res.diff, binary: res.binary, status: 'loaded' },
            };
          });
        })
        .catch(fail);
    },
    [cwd, scope, ignoreWhitespace, appSessionId, fileSignatures],
  );

  return { entries, ensure };
}
