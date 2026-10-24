import assert from 'node:assert/strict';
import test from 'node:test';
import {
  noteDraft,
  openWorkspace,
  reopenWorkspace,
  scopeFor,
  userScopeFor,
} from '../testing/canvasStorageSupport.js';
import type { AnnotationDraft } from './canvasAnnotationSchema.js';
import type { CanvasChange, CanvasScope } from './protocol.js';

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

  const pane = userScopeFor(canvasId, 'app-1');
  const change = await workspace.annotations.annotate(pane, input);
  const [saved] = change.annotations?.upserted ?? [];
  assert.equal(change.annotations?.version, 1);
  assert.ok(saved?.kind === 'path');
  assert.deepEqual(saved.points, [
    { x: 0, y: 0 },
    { x: 249, y: 0 },
    { x: 249, y: 250 },
  ]);
  assert.deepEqual(saved.author, { kind: 'user' });

  assert.deepEqual(await workspace.annotations.annotate(pane, input), change);
  assert.equal(published.length, 1);
  await assert.rejects(
    workspace.annotations.annotate(pane, { ...input, mutationId: 'draw-again' }),
    { code: 'revision_conflict' },
  );

  await workspace.close();
  const reopened = await reopenWorkspace(t, root, deps);
  const snapshot = reopened.snapshot(canvasId);
  assert.equal(snapshot.annotationsVersion, 1);
  assert.deepEqual(snapshot.annotations, [saved]);
});

test('a dense zigzag keeps its turns instead of collapsing to its ends', async (t) => {
  const { workspace, canvasId } = await canvas(t);
  // Every one of the 2048 points is a turn between the two rails, which a
  // tolerance that doubles would step over and leave a straight line.
  const zigzag = Array.from({ length: 2048 }, (_, index) => ({
    x: index,
    y: index % 2 === 0 ? 0 : 100,
  }));
  const change = await workspace.annotations.annotate(userScopeFor(canvasId, 'app-1'), {
    mutationId: 'draw-zigzag',
    expectedAnnotationsVersion: 0,
    upserts: [{ id: 'ann_zigzag', kind: 'path', color: 'ink', points: zigzag }],
    deletes: [],
  });
  const [saved] = change.annotations?.upserted ?? [];
  assert.ok(saved?.kind === 'path');
  assert.ok(saved.points.length > 2);
  const xs = saved.points.map((point) => point.x);
  const ys = saved.points.map((point) => point.y);
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [0, 100]);
  // The kept points span the stroke instead of crowding the end that deviates most.
  assert.ok(Math.min(...xs) === 0 && Math.max(...xs) > 1500);
});

test('an agent changes only what its own chat drew', async (t) => {
  const { workspace, canvasId } = await canvas(t);
  const pane = userScopeFor(canvasId, 'app-1');
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

  await annotate(pane, 0, [noteDraft('ann_user', 800, 0, 'Bigger')], []);
  const drawn = await annotate(mine, 1, [noteDraft('ann_mine', 800, 0, 'Bigger')], []);
  assert.deepEqual(drawn.annotations?.upserted[0]?.author, { kind: 'agent', chatId: 'app-1' });

  await assert.rejects(annotate(otherChat, 2, [], ['ann_user', 'ann_mine']), {
    code: 'invalid_input',
    message: /read-only to you: ann_user, ann_mine\./,
  });
  await assert.rejects(annotate(mine, 2, [noteDraft('ann_user', 800, 0, 'Mine now')], []), {
    message: /read-only to you: ann_user\./,
  });
  await assert.rejects(annotate(mine, 2, [], ['ann_gone']), { code: 'not_found' });

  // Its own note it may redraw and remove; the user may remove anything.
  await annotate(mine, 2, [noteDraft('ann_mine', 800, 0, 'Smaller')], []);
  await annotate(mine, 3, [], ['ann_mine']);
  await annotate(pane, 4, [], ['ann_user']);
  assert.deepEqual(workspace.snapshot(canvasId).annotations, []);
});
