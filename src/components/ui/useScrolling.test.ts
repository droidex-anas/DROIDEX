import assert from 'node:assert/strict';
import test from 'node:test';
import { trackScrolling } from './useScrolling';

class FakeScroller extends EventTarget {
  readonly attributes = new Set<string>();
  setAttribute(name: string) {
    this.attributes.add(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}

test('data-scrolling lasts until 800ms after the last scroll event', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const scroller = new FakeScroller();
  const stop = trackScrolling(scroller as unknown as HTMLElement);

  scroller.dispatchEvent(new Event('scroll'));
  t.mock.timers.tick(500);
  scroller.dispatchEvent(new Event('scroll'));
  t.mock.timers.tick(799);
  assert.ok(scroller.attributes.has('data-scrolling'));
  t.mock.timers.tick(1);
  assert.ok(!scroller.attributes.has('data-scrolling'));

  scroller.dispatchEvent(new Event('scroll'));
  stop();
  assert.ok(!scroller.attributes.has('data-scrolling'));
  scroller.dispatchEvent(new Event('scroll'));
  assert.ok(!scroller.attributes.has('data-scrolling'));
});
