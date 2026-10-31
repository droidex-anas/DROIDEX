import assert from 'node:assert/strict';
import test from 'node:test';
import { board } from '../testing/canvasBuildSupport.js';

const UNUSED_KIT = { message: 'The design imports nothing from the kit.', file: 'main.tsx' };

test('a stricter rule that fails the fallback revision leaves the design nothing to fall back to', async (t) => {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  const { revisionId } = await canvas.write(designId, null, 'export default () => <p>Hey</p>');
  const guided = await canvas.fleet.compile(1);
  assert.equal(guided.input.designSystemAdherence, 'guide');
  guided.ready('artifact-hey', [], [{ code: 'design_system_unused', ...UNUSED_KIT }]);
  await canvas.reported(designId, 'ready');
  assert.equal(
    canvas.workspace.buildTarget(canvas.canvasId, designId)?.lastWorkingRevisionId,
    revisionId,
  );

  await canvas.workspace.settings.setDesignSystemAdherence('app-1', canvas.canvasId, 'strict');
  const strict = await canvas.fleet.compile(2);
  assert.equal(strict.input.revisionId, revisionId);
  assert.equal(strict.input.designSystemAdherence, 'strict');
  strict.failed('design_system_unused', UNUSED_KIT);
  await canvas.reported(designId, 'failed');

  // The revision that just failed is no fallback: the pane shows no stale preview
  // and the agent is not told its failing revision last worked.
  const failed = {
    status: 'failed',
    revisionId,
    diagnostics: [{ code: 'design_system_unused', ...UNUSED_KIT }],
    lastWorkingRevisionId: null,
    generation: 2,
  };
  assert.deepEqual(canvas.frame(designId).build, failed);
  assert.equal(
    canvas.workspace.buildTarget(canvas.canvasId, designId)?.lastWorkingRevisionId,
    null,
  );
  assert.equal(canvas.workspace.listCanvases()[0]?.designSystemAdherence, 'strict');

  const reopened = await board(t, { store: canvas.store });
  assert.deepEqual(reopened.frame(designId).build, { ...failed, generation: 0 });
});
