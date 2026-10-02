import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReplayPlan, mulberry32, PERF_SCENARIOS, resolveScenario } from './scenario.js';

test('a seed fully determines the plan, and a different seed changes it', () => {
  const spec = resolveScenario('streaming');
  assert.deepEqual(buildReplayPlan(spec), buildReplayPlan(spec));
  assert.notDeepEqual(
    buildReplayPlan(resolveScenario('streaming', { seed: 1 })),
    buildReplayPlan(resolveScenario('streaming', { seed: 2 })),
  );

  const firstRandom = mulberry32(99);
  const secondRandom = mulberry32(99);
  const first = Array.from({ length: 5 }, () => firstRandom());
  const second = Array.from({ length: 5 }, () => secondRandom());
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length, 'the generator must advance between draws');
  assert.ok(first.every((value) => value >= 0 && value < 1));
});

test('plan shape matches the scenario parameters', () => {
  const spec = resolveScenario('smoke');
  const plan = buildReplayPlan(spec);

  assert.equal(plan.turns.length, spec.sessions * spec.turnsPerSession);
  const deltas = plan.turns
    .flatMap((turn) => turn.steps)
    .filter((step) => String(step.event.type).endsWith('_text_delta'));
  const markers = plan.turns.flatMap((turn) => turn.steps).filter((step) => step.marker !== null);
  assert.equal(deltas.length, spec.sessions * spec.turnsPerSession * spec.deltasPerTurn);
  assert.ok(markers.length > 0);
  assert.ok(
    markers.every((step) => step.marker?.startsWith('call:') || step.marker?.startsWith('result:')),
  );
});

test('steps inside a turn are scheduled in non-decreasing time order', () => {
  const plan = buildReplayPlan(resolveScenario('multi-agent'));
  for (const turn of plan.turns) {
    let previous = -1;
    for (const step of turn.steps) {
      assert.ok(step.atMs >= previous, `step at ${String(step.atMs)} after ${String(previous)}`);
      previous = step.atMs;
    }
  }
});

test('every listed scenario resolves under its own name, and unknown or inherited names do not', () => {
  // Reports and drift stats key off spec.name, so a builder filed under the
  // wrong key would misattribute every result it produces.
  for (const name of Object.keys(PERF_SCENARIOS)) {
    const spec = resolveScenario(name);
    assert.equal(spec.name, name);
    assert.ok(spec.expectedDurationMs > 0, name);
  }
  for (const name of ['does-not-exist', 'constructor', 'toString'])
    assert.throws(() => resolveScenario(name), /Unknown scenario/);
});
