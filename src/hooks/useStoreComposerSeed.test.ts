import assert from 'node:assert/strict';
import test from 'node:test';
import { activeDraftTileId } from '../features/tabs/tabNavigation';
import type { SessionSummary } from '../types/bridge';
import { initialState, reducer, type Action, type AppState } from './useStore';

const seedsFor = (state: AppState, appSessionId: string | null) =>
  state.composerSeeds.filter((seed) => seed.appSessionId === appSessionId).map((s) => s.text);

test('a composer seed records its intent and clears once consumed', () => {
  const seeded = reducer(initialState, { type: 'SEED_COMPOSER', text: 'Build a dashboard' });
  const seed = seeded.composerSeeds[0];
  assert.ok(seed);
  assert.equal(seed.text, 'Build a dashboard');
  assert.equal(seed.replace, false);
  assert.equal(seed.focus, true);

  const consumed = reducer(seeded, { type: 'CONSUME_COMPOSER_SEED', id: seed.id });
  assert.deepEqual(consumed.composerSeeds, []);

  // Consuming it again is a no-op, so repeat consumption is safe.
  assert.equal(reducer(consumed, { type: 'CONSUME_COMPOSER_SEED', id: seed.id }), consumed);

  // A fresh-chat seed records replacement intent.
  const replacing = reducer(initialState, {
    type: 'SEED_COMPOSER',
    text: '/review Pull request #129',
    replace: true,
  });
  assert.equal(replacing.composerSeeds[0]?.replace, true);

  // The browser's prompt box sends its seed at once, in the mode it chose, and
  // leaves the focus alone.
  const sending = reducer(initialState, {
    type: 'SEED_COMPOSER',
    text: 'make this bolder',
    send: 'steer',
    focus: false,
  });
  assert.equal(sending.composerSeeds[0]?.send, 'steer');
  assert.equal(sending.composerSeeds[0]?.focus, false);
});

test('each seed is bound to its chat as it arrives and waits there in order', () => {
  let state: AppState = { ...initialState, activeAppSessionId: 'a' };
  state = reducer(state, { type: 'SEED_COMPOSER', text: 'first note' });
  state = reducer(state, { type: 'SEED_COMPOSER', text: 'second note' });
  state = reducer(state, { type: 'SEED_COMPOSER', appSessionId: 'owner', text: 'kept prompt' });
  // Focusing another chat does not move the notes already bound to 'a'.
  state = { ...state, activeAppSessionId: 'b' };
  state = reducer(state, { type: 'SEED_COMPOSER', text: 'note for b' });

  assert.deepEqual(seedsFor(state, 'a'), ['first note', 'second note']);
  assert.deepEqual(seedsFor(state, 'owner'), ['kept prompt']);
  assert.deepEqual(seedsFor(state, 'b'), ['note for b']);
});

test('a sent seed goes to its chat, leaving a child picked while it waited', () => {
  let state: AppState = { ...initialState, activeAppSessionId: 'other' };
  state = reducer(state, {
    type: 'SEED_COMPOSER',
    appSessionId: 'owner',
    text: 'make this bolder',
    send: 'queue',
  });
  state = { ...state, selectedChild: { parentAppSessionId: 'owner', childSessionId: 'child' } };
  const sent = reducer(state, {
    type: 'CONSUME_COMPOSER_SEED',
    id: state.composerSeeds[0]?.id ?? -1,
  });
  assert.equal(sent.selectedChild, null);

  // A note leaves the child where it is.
  let noted = reducer(state, { type: 'SEED_COMPOSER', appSessionId: 'owner', text: 'a note' });
  noted = reducer(noted, { type: 'CONSUME_COMPOSER_SEED', id: noted.composerSeeds[1]?.id ?? -1 });
  assert.equal(noted.selectedChild, state.selectedChild);
});

test("a draft's seeds wait in its tile and go to the chat it becomes", () => {
  const draft = (state: AppState) =>
    state.composerSeeds.filter((seed) => seed.draftTileId === activeDraftTileId(state));
  // A suggestion picked while the draft is being sent waits for it.
  const sending = [
    { type: 'HOLD_COMPOSE_ORIGIN', holdId: 'c1' },
    {
      type: 'SET_PENDING_COMPOSE',
      clientRef: 'c1',
      text: 'hi',
      skills: [],
      files: [],
      originHoldId: 'c1',
    },
    { type: 'RELEASE_COMPOSE_ORIGIN', holdId: 'c1' },
    { type: 'SEED_COMPOSER', text: 'suggestion' },
  ] satisfies Action[];
  const state = sending.reduce(reducer, { ...initialState, mainView: 'session' });
  assert.equal(draft(state).length, 1);

  // Another tab's draft does not take it.
  assert.deepEqual(draft(reducer(state, { type: 'OPEN_NEW_CHAT_TAB' })), []);

  // The chat the draft becomes does.
  const session = { appSessionId: 'n', sessionPurpose: 'chat', updatedAt: 1 } as SessionSummary;
  const created = reducer(state, { type: 'SESSION_CREATED', clientRef: 'c1', session });
  assert.deepEqual(seedsFor(created, 'n'), ['suggestion']);

  // A draft left for a view takes its seeds with it, so the next one starts clean.
  const left = reducer(state, { type: 'OPEN_AUTOMATIONS' });
  assert.deepEqual(left.composerSeeds, []);
  const next = reducer(left, { type: 'START_CHAT', cwd: '', executionMode: 'local' });
  assert.deepEqual(draft(next), []);

  // The sent draft's chat arriving late leaves the new draft's seed where it is.
  const seeded = reducer(next, { type: 'SEED_COMPOSER', text: 'for the new draft' });
  const late = reducer(seeded, { type: 'SESSION_CREATED', clientRef: 'c1', session });
  assert.deepEqual(seedsFor(late, 'n'), []);
  assert.equal(draft(late).length, 1);
});
