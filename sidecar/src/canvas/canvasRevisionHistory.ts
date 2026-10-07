import type { CanvasWorkspace } from './CanvasWorkspace.js';
import { CanvasBuildCache } from './canvasBuildCache.js';
import { canvasError } from './canvasError.js';
import type { CanvasFiles } from './canvasFiles.js';
import type { CanvasHeads } from './canvasHeads.js';
import type {
  CanvasScope,
  RestoreRevisionInput,
  RevisionDiff,
  RevisionPage,
  RevisionSummary,
  SourceFiles,
  WriteReceipt,
} from './protocol.js';
import { CANVAS_LIMITS, revisionPageSchema } from './schema.js';

/** Reads the canonical commit index and source; it owns no separate history state. */
export class CanvasRevisionHistory {
  private readonly cache: CanvasBuildCache;

  constructor(
    private readonly workspace: CanvasWorkspace,
    private readonly heads: CanvasHeads,
    private readonly files: CanvasFiles,
  ) {
    this.cache = new CanvasBuildCache(files);
  }

  async listRevisions(
    canvasId: string,
    designId: string,
    page: RevisionPage,
  ): Promise<RevisionSummary[]> {
    const parsed = revisionPageSchema.safeParse(page);
    if (!parsed.success)
      throw canvasError(
        'invalid_input',
        'Choose a revision page size from 1 to 50 and a nonnegative sequence cursor.',
      );
    this.requireDesign(canvasId, designId);
    const history = this.records(canvasId);
    const records: typeof history = [];
    for (let index = history.length - 1; index >= 0 && records.length < page.limit; index -= 1) {
      const record = history[index];
      if (record.designId !== designId) continue;
      if (page.before !== undefined && record.sequence >= page.before) continue;
      records.push(record);
    }
    return Promise.all(
      records.map(async (record) => {
        const metadata = await this.files.readRevisionMetadata(canvasId, record);
        return {
          revisionId: record.revisionId,
          restoredFromRevisionId: record.restoredFromRevisionId,
          sequence: record.sequence,
          createdAt: metadata.createdAt,
          author: { ...record.author },
          designSystem: metadata.designSystem,
          buildStatus: await this.cache.revisionStatus(canvasId, designId, record.revisionId),
          mutationKind: record.mutationKind,
        };
      }),
    );
  }

  async readRevisionFiles(
    canvasId: string,
    designId: string,
    revisionId: string,
  ): Promise<SourceFiles> {
    this.requireRevision(canvasId, designId, revisionId);
    return this.workspace.readFiles(canvasId, { designId, revisionId });
  }

  async readRevisionMetadata(canvasId: string, designId: string, revisionId: string) {
    this.requireRevision(canvasId, designId, revisionId);
    return this.files.readRevisionMetadata(canvasId, { designId, revisionId });
  }

  async diffRevisions(
    canvasId: string,
    designId: string,
    from: string,
    to: string,
  ): Promise<RevisionDiff> {
    const [previous, next] = await Promise.all([
      this.readRevisionFiles(canvasId, designId, from),
      this.readRevisionFiles(canvasId, designId, to),
    ]);
    const result: RevisionDiff = { from, to, files: [], truncated: false };
    let remainingBytes = CANVAS_LIMITS.maxRevisionDiffBytes;
    const paths = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();
    for (const path of paths) {
      const before = Object.hasOwn(previous, path) ? previous[path] : undefined;
      const after = Object.hasOwn(next, path) ? next[path] : undefined;
      if (before === after) continue;
      let kind: 'added' | 'removed' | 'modified' = 'modified';
      if (before === undefined) kind = 'added';
      else if (after === undefined) kind = 'removed';
      let diff = '';
      for (const line of unifiedLines(path, before, after)) {
        const bytes = Buffer.byteLength(line, 'utf8');
        if (bytes > remainingBytes) {
          result.truncated = true;
          break;
        }
        diff += line;
        remainingBytes -= bytes;
      }
      result.files.push({ path, kind, diff });
    }
    return result;
  }

  private records(canvasId: string) {
    const manifest = this.heads.find(canvasId);
    if (!manifest) throw canvasError('not_found', 'That canvas is not available.');
    return manifest.revisions;
  }

  private requireDesign(canvasId: string, designId: string): void {
    if (!this.workspace.snapshot(canvasId).frames.some((frame) => frame.designId === designId))
      throw canvasError(
        'not_found',
        'That design was removed. Restore it to the board before using its revision history.',
      );
  }

  private requireRevision(canvasId: string, designId: string, revisionId: string): void {
    this.requireDesign(canvasId, designId);
    if (
      !this.records(canvasId).some(
        (record) => record.designId === designId && record.revisionId === revisionId,
      )
    )
      throw canvasError('not_found', 'That revision is not in this design’s saved history.');
  }
}

/** Restore is a normal source commit, including scope validation, CAS and retry receipts. */
export async function restoreRevision(
  workspace: CanvasWorkspace,
  scope: CanvasScope,
  input: RestoreRevisionInput,
): Promise<WriteReceipt> {
  const canvasId = scope.canvasId;
  if (canvasId === null)
    throw canvasError('not_found', 'Attach this chat to the canvas before restoring a revision.');
  const target = workspace.buildTarget(canvasId, input.designId);
  if (!target)
    throw canvasError('not_found', 'That design was removed. Restore it to the board first.');
  const mutation = { kind: 'restore', input } as const;
  const recorded = workspace.recordedSourceMutation(scope, input.designId, mutation);
  if (recorded) return recorded;
  const selected = await workspace.history.readRevisionMetadata(
    canvasId,
    input.designId,
    input.revisionId,
  );
  const source = await workspace.history.readRevisionFiles(
    canvasId,
    input.designId,
    input.revisionId,
  );
  const current =
    target.frame.revisionId === null
      ? {}
      : await workspace.readFiles(canvasId, {
          designId: input.designId,
          revisionId: target.frame.revisionId,
        });
  return workspace.write(
    scope,
    {
      mutationId: input.mutationId,
      designId: input.designId,
      expectedRevisionId: input.expectedRevisionId,
      files: source,
      deletedPaths: Object.keys(current).filter((path) => !Object.hasOwn(source, path)),
      designSystem: selected.designSystem,
    },
    mutation,
  );
}

// One exact replacement hunk with shared prefix/suffix context. Linear work avoids
// quadratic line matching on maximum-sized source; this is deliberately not a minimal diff.
function* unifiedLines(
  path: string,
  before: string | undefined,
  after: string | undefined,
): Generator<string> {
  const oldLines = sourceLines(before);
  const newLines = sourceLines(after);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - suffix - 1] === newLines[newLines.length - suffix - 1]
  )
    suffix += 1;
  const start = Math.max(0, prefix - 3);
  const context = Math.min(3, suffix);
  const oldEnd = oldLines.length - suffix;
  const newEnd = newLines.length - suffix;
  yield `--- ${before === undefined ? '/dev/null' : `a/${path}`}\n`;
  yield `+++ ${after === undefined ? '/dev/null' : `b/${path}`}\n`;
  const oldCount = oldEnd + context - start;
  const newCount = newEnd + context - start;
  const oldStart = oldCount === 0 ? 0 : start + 1;
  const newStart = newCount === 0 ? 0 : start + 1;
  yield `@@ -${String(oldStart)},${String(oldCount)} +${String(newStart)},${String(newCount)} @@\n`;
  for (let index = start; index < prefix; index += 1) yield diffLine(' ', oldLines[index]);
  for (let index = prefix; index < oldEnd; index += 1) yield diffLine('-', oldLines[index]);
  for (let index = prefix; index < newEnd; index += 1) yield diffLine('+', newLines[index]);
  for (let index = 0; index < context; index += 1) yield diffLine(' ', oldLines[oldEnd + index]);
}

function sourceLines(source: string | undefined): string[] {
  if (source === undefined || source === '') return [];
  const lines = source.split('\n');
  const last = lines.pop();
  const complete = lines.map((line) => `${line}\n`);
  if (last !== undefined && last !== '') complete.push(last);
  return complete;
}

function diffLine(prefix: string, line: string): string {
  return line.endsWith('\n')
    ? `${prefix}${line}`
    : `${prefix}${line}\n\\ No newline at end of file\n`;
}
