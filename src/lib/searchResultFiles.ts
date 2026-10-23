import { repoPathInProse } from './prosePaths';
import { stripAnsi } from './tools';

// A huge grep/glob result is parsed only far enough to fill the chip rail; the
// full output stays one disclosure away in the row's body.
const MAX_TRACKED_FILES = 100;

// ripgrep content and count lines lead with the path and a line (and optional
// column) number: `src/app.ts:12:const x`, `src/app.ts:12-context`. Count
// output (`src/app.ts:3`) needs no pattern: the trailing number is exactly
// what repoPathInProse trims on its own.
const NUMBERED_LINE = /^(.+?):\d+(?::\d+)?[:=-]/;

function pathFromOutputLine(line: string): string | null {
  const direct = repoPathInProse(line);
  if (direct) return direct;
  const numbered = NUMBERED_LINE.exec(line);
  return numbered?.[1] ? repoPathInProse(numbered[1]) : null;
}

// The distinct files a codebase-search result names, in result order. Glob and
// files-with-matches output are one path per line; content output leads each
// match with `path:line:`. Anything that is not unmistakably a path (prose
// summaries, `--` separators, bare match text) drops out.
export function searchResultFiles(output: string): string[] {
  const seen = new Set<string>();
  for (const raw of stripAnsi(output).split('\n')) {
    const path = pathFromOutputLine(raw.trim());
    if (path) seen.add(path);
    if (seen.size >= MAX_TRACKED_FILES) break;
  }
  return [...seen];
}
