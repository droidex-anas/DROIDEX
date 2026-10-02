import test from 'node:test';
import assert from 'node:assert/strict';

import {
  answerFor,
  canAdvance,
  createStepper,
  isLastStep,
  stepperReducer,
  submissionAnswers,
  type StepperAction,
  type StepperState,
} from './askUserStepper';

const QUESTIONS = [
  {
    index: 0,
    question: 'Which database?',
    options: [{ label: 'SQLite' }, { label: 'Postgres' }],
  },
  { index: 1, question: 'Which host?', options: [{ label: 'Local' }, { label: 'Cloud' }] },
];

function run(total: number, actions: StepperAction[]): StepperState {
  return actions.reduce(stepperReducer, createStepper(total));
}

test('picking an option records it and leaves typing mode', () => {
  const state = run(1, [
    { type: 'openCustomAnswer', questionIndex: 0 },
    { type: 'pickOption', questionIndex: 0, option: 'Postgres' },
  ]);

  assert.deepEqual(answerFor(state, 0).selected, ['Postgres']);
  assert.equal(answerFor(state, 0).typing, false);
  assert.equal(canAdvance(state, 0), true);
});

test('one choice replaces the last one, several toggle inside the answer', () => {
  const single = run(1, [
    { type: 'pickOption', questionIndex: 0, option: 'SQLite' },
    { type: 'pickOption', questionIndex: 0, option: 'Postgres' },
  ]);
  assert.deepEqual(answerFor(single, 0).selected, ['Postgres']);

  const multi = run(1, [
    { type: 'pickOption', questionIndex: 0, option: 'SQLite', multiSelect: true },
    { type: 'pickOption', questionIndex: 0, option: 'Postgres', multiSelect: true },
  ]);
  assert.deepEqual(answerFor(multi, 0).selected, ['SQLite', 'Postgres']);

  const unpicked = stepperReducer(multi, {
    type: 'pickOption',
    questionIndex: 0,
    option: 'SQLite',
    multiSelect: true,
  });
  assert.deepEqual(answerFor(unpicked, 0).selected, ['Postgres']);
});

test('typing replaces a single choice and joins several', () => {
  const single = run(1, [
    { type: 'pickOption', questionIndex: 0, option: 'SQLite' },
    { type: 'typeAnswer', questionIndex: 0, value: 'Turso' },
  ]);
  assert.deepEqual(answerFor(single, 0).selected, []);
  assert.equal(answerFor(single, 0).custom, 'Turso');
  assert.equal(answerFor(single, 0).typing, true);

  const multi = run(1, [
    { type: 'pickOption', questionIndex: 0, option: 'SQLite', multiSelect: true },
    { type: 'typeAnswer', questionIndex: 0, value: 'Turso', multiSelect: true },
  ]);
  assert.deepEqual(answerFor(multi, 0).selected, ['SQLite']);
  assert.equal(answerFor(multi, 0).custom, 'Turso');

  // Picking another option keeps the typed answer in sight: it is still sent.
  const more = stepperReducer(multi, {
    type: 'pickOption',
    questionIndex: 0,
    option: 'Postgres',
    multiSelect: true,
  });
  assert.equal(answerFor(more, 0).typing, true);
  assert.equal(answerFor(more, 0).custom, 'Turso');
});

test('the custom field opens on the answer already held', () => {
  const picked = run(1, [
    { type: 'pickOption', questionIndex: 0, option: 'SQLite' },
    { type: 'openCustomAnswer', questionIndex: 0 },
  ]);

  assert.deepEqual(answerFor(picked, 0).selected, ['SQLite']);
  assert.equal(answerFor(picked, 0).typing, true);
});

test('a whitespace-only answer cannot advance', () => {
  const state = run(1, [{ type: 'typeAnswer', questionIndex: 0, value: '   ' }]);

  assert.equal(canAdvance(state, 0), false);
});

test('forward and back clamp to the question range', () => {
  const atEnd = run(2, [{ type: 'forward' }, { type: 'forward' }]);
  assert.equal(atEnd.current, 1);
  assert.equal(isLastStep(atEnd), true);

  const atStart = run(2, [{ type: 'back' }]);
  assert.equal(atStart.current, 0);
});

test('answers stay attached to their own question across back and forward', () => {
  const state = run(2, [
    { type: 'pickOption', questionIndex: 0, option: 'SQLite' },
    { type: 'forward' },
    { type: 'typeAnswer', questionIndex: 1, value: 'Fly.io' },
    { type: 'back' },
    { type: 'pickOption', questionIndex: 0, option: 'Postgres' },
    { type: 'forward' },
  ]);

  assert.deepEqual(answerFor(state, 0).selected, ['Postgres']);
  assert.equal(answerFor(state, 1).custom, 'Fly.io');
  assert.equal(answerFor(state, 0).typing, false);
  assert.equal(answerFor(state, 1).typing, true);
});

test('the submission payload carries every question with what it holds', () => {
  const state = run(2, [
    { type: 'pickOption', questionIndex: 0, option: 'Postgres', multiSelect: true },
    { type: 'pickOption', questionIndex: 0, option: 'SQLite', multiSelect: true },
    { type: 'forward' },
    { type: 'typeAnswer', questionIndex: 1, value: '  Fly.io  ' },
  ]);

  assert.deepEqual(submissionAnswers(QUESTIONS, state), [
    { index: 0, question: 'Which database?', selected: ['Postgres', 'SQLite'] },
    { index: 1, question: 'Which host?', selected: [], custom: 'Fly.io' },
  ]);
});

test('unanswered questions submit as empty answers rather than being dropped', () => {
  const state = run(2, [{ type: 'pickOption', questionIndex: 0, option: 'SQLite' }]);

  assert.deepEqual(submissionAnswers(QUESTIONS, state), [
    { index: 0, question: 'Which database?', selected: ['SQLite'] },
    { index: 1, question: 'Which host?', selected: [] },
  ]);
});
