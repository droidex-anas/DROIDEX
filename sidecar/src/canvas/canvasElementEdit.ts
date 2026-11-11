// Direct pane edits resolve their selection against the current build, then
// commit through the workspace's normal revision CAS and scope gate.

import type { CanvasBuilds } from './CanvasBuilds.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';
import { canvasError, CanvasCommandError } from './canvasError.js';
import { CompileCancelledError, CompilerWorker, type EditedSource } from './compiler.js';
import type { CanvasScope, EditElementInput, WriteReceipt } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

/** The edit's revision, and the nodeId of the row a layer edit lands on in it; null for other edits and replays. */
export async function editCanvasElement(
  workspace: CanvasWorkspace,
  builds: CanvasBuilds,
  scope: Extract<CanvasScope, { origin: 'user' }>,
  input: EditElementInput,
): Promise<{ receipt: WriteReceipt; landed: string | null }> {
  const { edit } = input;
  const edited = 'element' in edit ? edit.element : edit.layer;
  // A successful edit advanced this revision, so its retry must be answered first.
  const recorded = workspace.recordedEdit(scope, edited.designId, input);
  if (recorded) return { receipt: recorded, landed: null };
  const target = workspace.buildTarget(scope.canvasId, edited.designId);
  if (!target) throw canvasError('invalid_input', 'That design is not on this canvas.');
  const { frame } = target;
  if (frame.revisionId !== edited.revisionId)
    throw canvasError('stale_revision', 'This design changed. Reselect the element and try again.');
  const build = builds.stateOf(scope.canvasId, edited.designId);
  if (build.status !== 'ready' || build.revisionId !== edited.revisionId)
    throw canvasError('stale_reference', 'Rebuild the design and reselect the element.');

  if (edit.change.kind === 'image')
    throw canvasError(
      'unsupported_edit',
      'Image replacement is unavailable until Canvas assets can verify ownership.',
    );
  const source = await workspace.readFiles(scope.canvasId, edited);
  const worker = new CompilerWorker();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, CANVAS_LIMITS.buildDeadlineMs).unref();
  let result: EditedSource;
  try {
    result = await worker.edit(source, build.elements, edit, frame.designSystem, controller.signal);
  } catch (error) {
    if (error instanceof CompileCancelledError)
      throw canvasError('build_timeout', 'This edit took too long. Try again.');
    throw error;
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
  try {
    const receipt = await workspace.write(
      scope,
      {
        mutationId: input.mutationId,
        designId: edited.designId,
        expectedRevisionId: edited.revisionId,
        files: result.files,
        deletedPaths: [],
      },
      { mutation: { kind: 'edit', input } },
    );
    return { receipt, landed: result.landed };
  } catch (error) {
    if (error instanceof CanvasCommandError && error.code === 'revision_conflict')
      throw canvasError(
        'stale_revision',
        'This design changed. Reselect the element and try again.',
      );
    throw error;
  }
}
