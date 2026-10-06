import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { canvasRoot, quietBuilds } from '../testing/canvasStorageSupport.js';
import { CanvasCommandError } from './canvasError.js';
import { CanvasScopes } from './canvasScopes.js';
import { assertCanvasTurnContext, CanvasTurns } from './canvasTurnContext.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import { DEFAULT_DESIGN_SYSTEM_REF } from './designSystems.js';
import type { CanvasTurnContext } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const TOO_MANY_DESIGNS = `One request pins at most ${String(CANVAS_LIMITS.maxPinnedDesigns)} designs.`;

function context(...designIds: string[]): CanvasTurnContext {
  return {
    designs: designIds.map((designId) => ({ designId, revisionId: null })),
    elements: [],
    designSystem,
  };
}

/** A selection of one element inside a design, with no frame chip beside it. */
function elementContext(designId: string): CanvasTurnContext {
  return {
    designs: [],
    elements: [{ designId, revisionId: 'rev_01', elementId: 'el_1', instancePath: '0/2' }],
    designSystem,
  };
}

/** A lease owner over a real registry, reporting the attachment the test set. */
function turnsFor(attachedCanvasId: string | null = null) {
  const scopes = new CanvasScopes();
  const turns = new CanvasTurns(scopes, () => attachedCanvasId);
  return { scopes, turns };
}

/** The chat's newest live lease, which every case here expects a turn to hold. */
function lease(turns: CanvasTurns, appSessionId: string) {
  const scope = turns.activeScope(appSessionId);
  assert.ok(scope?.origin === 'turn');
  return scope;
}

test('a turn pins the references its prompt carried, and nothing it did not', () => {
  const { turns } = turnsFor('cv_01');

  turns.beginTurn('app-1', context('dsg_hey'));
  const pinned = lease(turns, 'app-1');
  assert.deepEqual(pinned.context, context('dsg_hey'));
  assert.deepEqual(pinned.allowedDesignIds, ['dsg_hey']);
  assert.equal(pinned.canvasId, 'cv_01');

  // An element names the design it sits in, so selecting one is not authority
  // over every other design on the board.
  turns.beginTurn('app-2', elementContext('dsg_selected'));
  assert.deepEqual(lease(turns, 'app-2').allowedDesignIds, ['dsg_selected']);

  // A prompt that pinned nothing to point at is a request about the whole canvas.
  turns.beginTurn('app-4', context());
  assert.equal(lease(turns, 'app-4').allowedDesignIds, 'canvas');

  // An ordinary chat can work on its attached canvas without opening the pane.
  turns.beginTurn('app-3', undefined);
  const ordinary = lease(turns, 'app-3');
  assert.deepEqual(ordinary.context, {
    designs: [],
    elements: [],
    designSystem: DEFAULT_DESIGN_SYSTEM_REF,
  });
  assert.equal(ordinary.allowedDesignIds, 'canvas');
  assert.equal(ordinary.canvasId, 'cv_01');
});

test('a steer leases its own references beside the running turn, never over them', () => {
  const { turns } = turnsFor('cv_01');
  const turn = turns.beginTurn('app-1', context('dsg_hey'));
  const primary = lease(turns, 'app-1');

  turn.addSteer(context('dsg_other'));
  const steer = lease(turns, 'app-1');
  assert.notEqual(steer.scopeId, primary.scopeId);
  assert.deepEqual(steer.allowedDesignIds, ['dsg_other']);
  // The turn's own lease is unchanged and still answers by name, so a call
  // already in flight under it is answered rather than retargeted.
  assert.equal(turns.requireScope(primary.scopeId), primary);
  assert.deepEqual(primary.allowedDesignIds, ['dsg_hey']);

  // The turn owns both, so settling it takes the steer's lease with it.
  turn.revoke();
  assert.equal(turns.activeScope('app-1'), undefined);
  for (const scope of [primary, steer])
    assert.throws(() => turns.requireScope(scope.scopeId), { code: 'scope_expired' });

  // A steer the harness delivered after the turn ended leases nothing.
  turn.addSteer(context('dsg_late'));
  assert.equal(turns.activeScope('app-1'), undefined);
});

test('a settled turn revokes once, and never a later turn or a replacement', () => {
  const { turns } = turnsFor('cv_01');
  const first = turns.beginTurn('app-1', context('dsg_hey'));
  first.revoke();
  first.revoke();

  // The next turn's lease is its own; the settled turn's handle cannot reach it.
  const second = turns.beginTurn('app-1', context('dsg_hey'));
  const running = lease(turns, 'app-1');
  first.revoke();
  assert.equal(turns.activeScope('app-1'), running);

  // The provider is replaced while that turn is still pending: its lease goes,
  // and the stale settlement arriving afterwards touches nothing.
  turns.endSession('app-1');
  assert.equal(turns.activeScope('app-1'), undefined);
  const replacement = turns.beginTurn('app-1', context('dsg_hey'));
  const minted = lease(turns, 'app-1');
  second.addSteer(context('dsg_late'));
  assert.equal(turns.activeScope('app-1'), minted);
  second.revoke();
  assert.equal(turns.activeScope('app-1'), minted);
  assert.equal(minted.generation, running.generation + 1);
  replacement.revoke();
});

test('a steer delivered after its chat’s provider was replaced leases nothing', () => {
  const { turns } = turnsFor('cv_01');
  const turn = turns.beginTurn('app-1', context('dsg_hey'));

  // The harness was still delivering this steer when the provider session the
  // turn ran on was replaced, so there is no running turn to authorize it.
  turns.endSession('app-1');
  turn.addSteer(context('dsg_steered'));
  assert.equal(turns.activeScope('app-1'), undefined);
});

test('a pane mutation’s scope is not a turn lease', () => {
  const { scopes, turns } = turnsFor('cv_01');
  scopes.register({
    origin: 'user',
    scopeId: 'user:one',
    appSessionId: 'app-1',
    canvasId: 'cv_01',
    allowedDesignIds: 'canvas',
  });
  assert.throws(() => turns.requireScope('user:one'), { code: 'scope_expired' });
});

test('an unattached ordinary chat mints a null binding its first create fills', async (t: TestContext) => {
  const { scopes, turns } = turnsFor(null);
  const workspace = await CanvasWorkspace.open(await canvasRoot(t), quietBuilds(), scopes);
  t.after(() => workspace.close());

  turns.beginTurn('app-1', undefined);
  const scope = lease(turns, 'app-1');
  assert.equal(scope.canvasId, null);

  const created = await workspace.create(scope, {
    mutationId: 'create-hey',
    frames: [{ name: 'Hey', width: 720, height: 720, designSystem: DEFAULT_DESIGN_SYSTEM_REF }],
  });
  // One commit made the canvas, the chat's attachment and the lease's binding.
  assert.equal(workspace.attachedCanvasId('app-1'), created.canvasId);
  assert.equal(lease(turns, 'app-1').canvasId, created.canvasId);
});

test('a malformed pinned context is refused with the limit’s own message', () => {
  const tooMany = {
    ...context(),
    designs: Array.from({ length: CANVAS_LIMITS.maxPinnedDesigns + 1 }, (_entry, index) => ({
      designId: `dsg_${String(index)}`,
      revisionId: null,
    })),
  };
  assert.throws(() => assertCanvasTurnContext(tooMany), {
    code: 'invalid_input',
    message: TOO_MANY_DESIGNS,
  });

  // The payload never travels: an unusable design ID is reported as the rule it
  // broke, not echoed back.
  assert.throws(
    () =>
      assertCanvasTurnContext({
        ...context(),
        designs: [{ designId: '../etc', revisionId: null }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof CanvasCommandError);
      assert.equal(error.code, 'invalid_input');
      assert.equal(error.message.includes('../etc'), false);
      return true;
    },
  );

  assert.throws(() => assertCanvasTurnContext({ designs: [], elements: [] }), {
    code: 'invalid_input',
  });
  assert.throws(() => assertCanvasTurnContext({ ...context(), extra: 1 }), {
    code: 'invalid_input',
  });
  assertCanvasTurnContext(context('dsg_hey'));
});
