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

test('input carries its own autonomy and unrelated user input is never inherited from agent work', async () => {
  const provenance = createBrowserNavigationProvenance();
  const entry = { documents: 1 };
  const contents = {};
  const input = { type: 'mousePressed', x: 20, y: 30, button: 'left' };
  const nativeInput = { ...input, type: 'mouseDown' };
  await provenance.dispatch(entry, contents, { autonomy: 'high' }, input, async () => {
    provenance.physicalInput(entry, contents, nativeInput);
    assert.equal(provenance.consume(entry, contents, 'https://site.test/').autonomy, 'high');
    provenance.physicalInput(entry, contents, { ...nativeInput, x: 50 });
    assert.equal(provenance.consume(entry, contents, 'https://site.test/').initiator, 'user');
  });
  const stale = provenance.consume(entry, contents, 'https://site.test/');
  assert.equal(stale.initiator, 'agent');
  assert.equal(stale.autonomy, 'low');
});
