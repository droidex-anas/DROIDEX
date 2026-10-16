import assert from 'node:assert/strict';
import test from 'node:test';

// The stack installs its window listener when the module loads.
const fakeWindow = new EventTarget();
Object.assign(globalThis, { window: fakeWindow });
const { pushEscapeLayer } = await import('./escapeStack');

function pressEscape(): void {
  fakeWindow.dispatchEvent(
    Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }),
  );
}

test('Escape closes only the most recently opened layer', () => {
  const closed: string[] = [];
  const popOuter = pushEscapeLayer(() => closed.push('outer'));
  const popInner = pushEscapeLayer(() => closed.push('inner'));
  let laterListenerRan = false;
  const later = () => {
    laterListenerRan = true;
  };
  fakeWindow.addEventListener('keydown', later, true);

  pressEscape();
  assert.deepEqual(closed, ['inner']);
  assert.equal(laterListenerRan, false);

  popInner();
  pressEscape();
  assert.deepEqual(closed, ['inner', 'outer']);

  popOuter();
  pressEscape();
  assert.deepEqual(closed, ['inner', 'outer']);
  assert.equal(laterListenerRan, true);
  fakeWindow.removeEventListener('keydown', later, true);
});

test('a StrictMode double push leaves one copy after its cleanup', () => {
  const closed: string[] = [];
  const close = () => closed.push('layer');
  const popFirst = pushEscapeLayer(close);
  const popSecond = pushEscapeLayer(close);
  popSecond();
  pressEscape();
  assert.deepEqual(closed, ['layer']);
  popFirst();
});
