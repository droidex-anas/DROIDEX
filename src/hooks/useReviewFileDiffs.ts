import { useCallback, useRef, useState } from 'react';
import { getGitFileDiff } from '../lib/git';
import type { DiffScope } from '../types/vcs';
import type { ReviewFileVersion } from './useReviewDiff';

export interface FileDiffEntry {
  diff: string;
  binary: boolean;
  status: 'loading' | 'loaded' | 'failed';
  loading: boolean;
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
  fileVersions: ReadonlyMap<string, ReviewFileVersion>,
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
  const versionsRef = useRef(fileVersions);

  // Adjust cache state during render (the supported React pattern for resetting
  // when inputs change) so a fresh generation is in effect before any effect
  // calls ensure() this commit.
  if (hardRef.current !== hardKey) {
    hardRef.current = hardKey;
    versionsRef.current = fileVersions;
    status.current.clear();
    fileGen.current.clear();
    gen.current += 1;
    setEntries({});
  } else if (versionsRef.current !== fileVersions) {
    const prev = versionsRef.current;
    versionsRef.current = fileVersions;
    // Keep existing entries visible; ensure() refetches and overwrites in
    // place. Files whose line vanished also drop their status so a later
    // reappearance refetches instead of serving the stale diff.
    for (const path of status.current.keys()) {
      if (fileVersions.get(path)?.signature !== prev.get(path)?.signature) {
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
                [path]: { diff: '', binary: false, status: 'failed', loading: false },
              },
        );
      };
      setEntries((cur) => {
        const prev = cur[path];
        if (prev?.status === 'loaded') return cur;
        if (prev?.status === 'failed') return { ...cur, [path]: { ...prev, loading: true } };
        return {
          ...cur,
          [path]: {
            diff: '',
            binary: false,
            status: 'loading',
            loading: true,
          },
        };
      });
      getGitFileDiff(cwd, {
        mode: scope,
        path,
        oldPath: fileVersions.get(path)?.oldPath ?? null,
        ignoreWhitespace,
        appSessionId,
      })
        .then((res) => {
          if (stale()) return;
          if (res.failed) {
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
              [path]: { diff: res.diff, binary: res.binary, status: 'loaded', loading: false },
            };
          });
        })
        .catch(fail);
    },
    [cwd, scope, ignoreWhitespace, appSessionId, fileVersions],
  );

  return { entries, ensure };
}
