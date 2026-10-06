// Direct pane edits resolve their selection against the current build, then
// commit through the workspace's normal revision CAS and scope gate.

import type { CanvasBuilds } from './CanvasBuilds.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';
import { canvasError, CanvasCommandError } from './canvasError.js';
import { CompileCancelledError, CompilerWorker } from './compiler.js';
import type { CanvasScope, EditElementInput, SourceFiles, WriteReceipt } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

export async function editCanvasElement(
  workspace: CanvasWorkspace,
  builds: CanvasBuilds,
  scope: Extract<CanvasScope, { origin: 'user' }>,
  input: EditElementInput,
): Promise<WriteReceipt> {
  const { element, change } = input.edit;
  const target = workspace.buildTarget(scope.canvasId, element.designId);
  if (!target) throw canvasError('invalid_input', 'That design is not on this canvas.');
  const { frame } = target;
  if (frame.revisionId !== element.revisionId)
    throw canvasError('stale_revision', 'This design changed. Reselect the element and try again.');
  const build = builds.stateOf(scope.canvasId, element.designId);
  if (build.status !== 'ready' || build.revisionId !== element.revisionId)
    throw canvasError('stale_reference', 'Rebuild the design and reselect the element.');

  if (change.kind === 'image')
    throw canvasError(
      'unsupported_edit',
      'Image replacement is unavailable until Canvas assets can verify ownership.',
    );
  const files = await workspace.readFiles(scope.canvasId, element);
  const worker = new CompilerWorker();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CANVAS_LIMITS.buildDeadlineMs).unref();
  let changed: SourceFiles;
  try {
    changed = await worker.edit(
      files,
      build.elements,
      input.edit,
      frame.designSystem,
      controller.signal,
    );
  } catch (error) {
    if (error instanceof CompileCancelledError)
      throw canvasError('build_timeout', 'This edit took too long. Try again.');
    throw error;
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
  try {
    return await workspace.write(scope, {
      mutationId: input.mutationId,
      designId: element.designId,
      expectedRevisionId: element.revisionId,
      files: changed,
      deletedPaths: [],
    });
  } catch (error) {
    if (error instanceof CanvasCommandError && error.code === 'revision_conflict')
      throw canvasError(
        'stale_revision',
        'This design changed. Reselect the element and try again.',
      );
    throw error;
  }
}
