// Where a build's diagnostics belong in the source drawer. The build reports
// them against its own module graph, which is wider than the files the drawer
// lists, so placing them is its own small job: the drawer marks what it can
// show the user, and states the rest plainly instead of guessing a line.

import type { CanvasBuildState, CanvasDiagnostic } from './protocol';

/**
 * The diagnostics a build left behind. A build that has not produced any yet
 * has none; that never means the last ones still stand.
 */
export function buildDiagnostics(build: CanvasBuildState): readonly CanvasDiagnostic[] {
  return build.status === 'ready' || build.status === 'failed' ? build.diagnostics : [];
}

/** One diagnostic placed in the editor, or in the panel's own list. */
export interface SourceIssue {
  diagnostic: CanvasDiagnostic;
  /** The listed file it belongs to, or null when it is not in this tree. */
  path: string | null;
  /** The 1-based line the build reported, or null when it named no line. */
  line: number | null;
}

/**
 * Places each diagnostic on a file and a line. A diagnostic can name a file
 * outside the frame's own tree — the pinned design kit is built with it — and a
 * failure in a generated module names no file at all. Neither can be pinned to
 * a line the user can see, so both stay unplaced instead of landing on the
 * wrong one.
 */
export function placeIssues(
  diagnostics: readonly CanvasDiagnostic[],
  paths: readonly string[],
): SourceIssue[] {
  const listed = new Set(paths);
  return diagnostics.map((diagnostic) => {
    const named = diagnostic.file;
    const path = named !== undefined && listed.has(named) ? named : null;
    const line = diagnostic.line;
    return {
      diagnostic,
      path,
      line: path !== null && line !== undefined && line > 0 ? line : null,
    };
  });
}

/** The issues the editor marks on one file's lines, by line number. */
export function issuesByLine(
  issues: readonly SourceIssue[],
  path: string,
): Map<number, SourceIssue[]> {
  const byLine = new Map<number, SourceIssue[]>();
  for (const issue of issues) {
    if (issue.path !== path || issue.line === null) continue;
    const held = byLine.get(issue.line);
    if (held) held.push(issue);
    else byLine.set(issue.line, [issue]);
  }
  return byLine;
}
