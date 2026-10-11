import assert from 'node:assert/strict';
import test from 'node:test';
import { openWorkspace, reopenWorkspace, scopeFor } from '../testing/canvasStorageSupport.js';
import type { AnnotationDraft } from './canvasAnnotationSchema.js';
import type { CanvasChange, CanvasScope } from './protocol.js';

function userScope(canvasId: string): CanvasScope {
  return {
    origin: 'user',
    scopeId: 'user:1',
    appSessionId: 'app-1',
    canvasId,
    allowedDesignIds: 'canvas',
  };
}

function note(id: string, text = 'Bigger'): AnnotationDraft {
  return {
    id,
    kind: 'note',
    color: 'yellow',
    rect: { x: 800, y: 0, width: 200, height: 120 },
    text,
  };
}

async function canvas(t: Parameters<typeof openWorkspace>[0]) {
  const context = await openWorkspace(t);
  const { canvasId } = await context.workspace.createCanvas('app-1', 'explicit-app-1');
  return { ...context, canvasId };
}

test('a user sketch saves simplified, a stale version conflicts, and a retry answers once', async (t) => {
  const { root, deps, workspace, canvasId } = await canvas(t);
  const published: CanvasChange[] = [];
  workspace.changes.subscribe((change) => published.push(change));
  // An L drawn as 500 points: only its two ends and the corner carry the shape.
  const points = Array.from({ length: 500 }, (_, index) =>
    index < 250 ? { x: index, y: 0 } : { x: 249, y: index - 249 },
  );
  const input = {
    mutationId: 'draw-l',
    expectedAnnotationsVersion: 0,
    upserts: [{ id: 'ann_l', kind: 'path', color: 'ink', points } satisfies AnnotationDraft],
    deletes: [],
  };

  const change = await workspace.annotations.annotate(userScope(canvasId), input);
  const [saved] = change.annotations?.upserted ?? [];
  assert.equal(change.annotations?.version, 1);
  assert.ok(saved?.kind === 'path');
  assert.deepEqual(saved.points, [
    { x: 0, y: 0 },
    { x: 249, y: 0 },
    { x: 249, y: 250 },
  ]);
  assert.deepEqual(saved.author, { kind: 'user' });

  assert.deepEqual(await workspace.annotations.annotate(userScope(canvasId), input), change);
  assert.equal(published.length, 1);
  await assert.rejects(
    workspace.annotations.annotate(userScope(canvasId), { ...input, mutationId: 'draw-again' }),
    { code: 'revision_conflict' },
  );

  await workspace.close();
  const reopened = await reopenWorkspace(t, root, deps);
  const snapshot = reopened.snapshot(canvasId);
  assert.equal(snapshot.annotationsVersion, 1);
  assert.deepEqual(snapshot.annotations, [saved]);
});

test('an agent changes only what its own chat drew', async (t) => {
  const { workspace, canvasId } = await canvas(t);
  const mine = scopeFor(canvasId);
  const otherChat: CanvasScope = { ...mine, scopeId: 'scope-2', appSessionId: 'app-2' };
  const annotate = (
    scope: CanvasScope,
    version: number,
    upserts: AnnotationDraft[],
    deletes: string[],
  ) =>
    workspace.annotations.annotate(scope, {
      mutationId: `annotate-${String(version)}-${scope.scopeId}`,
      expectedAnnotationsVersion: version,
      upserts,
      deletes,
    });

  await annotate(userScope(canvasId), 0, [note('ann_user')], []);
  const drawn = await annotate(mine, 1, [note('ann_mine')], []);
  assert.deepEqual(drawn.annotations?.upserted[0]?.author, { kind: 'agent', chatId: 'app-1' });

  await assert.rejects(annotate(otherChat, 2, [], ['ann_user', 'ann_mine']), {
    code: 'invalid_input',
    message: /read-only to you: ann_user, ann_mine\./,
  });
  await assert.rejects(annotate(mine, 2, [note('ann_user', 'Mine now')], []), {
    message: /read-only to you: ann_user\./,
  });
  await assert.rejects(annotate(mine, 2, [], ['ann_gone']), { code: 'not_found' });

  // Its own note it may redraw and remove; the user may remove anything.
  await annotate(mine, 2, [note('ann_mine', 'Smaller')], []);
  await annotate(mine, 3, [], ['ann_mine']);
  await annotate(userScope(canvasId), 4, [], ['ann_user']);
  assert.deepEqual(workspace.snapshot(canvasId).annotations, []);
});
