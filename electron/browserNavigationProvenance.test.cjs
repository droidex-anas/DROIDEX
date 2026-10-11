const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserNavigationProvenance } = require('./browserNavigationProvenance.cjs');

test('physical navigation is single-use and cannot cross documents, destinations or expiry', () => {
  let now = 1_000;
  const provenance = createBrowserNavigationProvenance({ now: () => now });
  const contents = {};
  const entry = { documents: 3 };
  const record = () =>
    provenance.record(entry, contents, { initiator: 'user' }, 'https://site.test/');
  const take = (url = 'https://site.test/') => provenance.consume(entry, contents, url).initiator;
  record();
  assert.equal(take(), 'user');
  assert.equal(take(), 'agent');
  record();
  assert.equal(take('https://other.test/'), 'agent');
  assert.equal(take(), 'agent');
  record();
  entry.documents++;
  assert.equal(take(), 'agent');
  record();
  now = 2_001;
  assert.equal(take(), 'agent');
  record();
  assert.equal(provenance.consume(entry, {}, 'https://site.test/').initiator, 'agent');
});

test('physical input never takes over a navigation the agent dispatched', () => {
  let now = 1_000;
  const provenance = createBrowserNavigationProvenance({ now: () => now });
  const entry = { documents: 1 };
  const contents = {};
  const take = () => provenance.consume(entry, contents, 'https://site.test/');
  provenance.record(entry, contents, { initiator: 'agent', autonomy: 'high' });
  // An honest submit handler awaits validation while the user keeps typing.
  provenance.physicalInput(entry, contents, { type: 'keyDown', key: 'ArrowDown' });
  provenance.physicalInput(entry, contents, { type: 'mouseDown' });
  const claimed = take();
  assert.deepEqual([claimed.initiator, claimed.autonomy], ['agent', 'high']);
  assert.equal(take().autonomy, 'low');
  now += 1_001;
  provenance.physicalInput(entry, contents, { type: 'keyDown', key: 'ArrowDown' });
  assert.equal(take().initiator, 'agent');
  provenance.physicalInput(entry, contents, { type: 'keyDown', key: 'Enter' });
  assert.equal(take().initiator, 'user');
});
