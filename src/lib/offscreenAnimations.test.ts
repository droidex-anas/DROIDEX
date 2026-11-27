import assert from 'node:assert/strict';
import test from 'node:test';
import { pauseAnimationsWhenOffscreen } from './offscreenAnimations';

interface FakeEntry {
  target: Element;
  isIntersecting: boolean;
}

class FakeObserver {
  static created: FakeObserver[] = [];
  readonly observed = new Set<Element>();
  private readonly callback: (entries: FakeEntry[]) => void;

  constructor(callback: (entries: FakeEntry[]) => void) {
    this.callback = callback;
    FakeObserver.created.push(this);
  }

  observe(element: Element) {
    this.observed.add(element);
  }

  unobserve(element: Element) {
    this.observed.delete(element);
  }

  fire(element: Element, isIntersecting: boolean) {
    this.callback([{ target: element, isIntersecting }]);
  }
}

interface FakeElement {
  element: HTMLElement;
  hasPauseAttribute: () => boolean;
}

function fakeElement(): FakeElement {
  const attributes = new Set<string>();
  const element = {
    setAttribute(name: string) {
      attributes.add(name);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
  };
  return {
    element: element as unknown as HTMLElement,
    hasPauseAttribute: () => attributes.has('data-pause-animations'),
  };
}

function installFakeObserver(): void {
  const globalRef = globalThis as { IntersectionObserver?: unknown };
  globalRef.IntersectionObserver = FakeObserver;
}

installFakeObserver();

test('an element leaving the viewport carries the pause attribute until it intersects again', () => {
  const { element, hasPauseAttribute } = fakeElement();
  const cleanup = pauseAnimationsWhenOffscreen(element);
  const observer = FakeObserver.created.at(-1);
  assert.ok(observer !== undefined);
  assert.ok(observer.observed.has(element));
  assert.equal(hasPauseAttribute(), false);

  observer.fire(element, false);
  assert.equal(hasPauseAttribute(), true);

  observer.fire(element, true);
  assert.equal(hasPauseAttribute(), false);

  cleanup?.();
});

test('the cleanup unobserves the element and clears the pause attribute', () => {
  const { element, hasPauseAttribute } = fakeElement();
  const cleanup = pauseAnimationsWhenOffscreen(element);
  const observer = FakeObserver.created.at(-1);
  assert.ok(observer !== undefined);
  assert.ok(observer.observed.has(element));

  observer.fire(element, false);
  assert.equal(hasPauseAttribute(), true);

  cleanup?.();
  assert.equal(observer.observed.has(element), false);
  assert.equal(hasPauseAttribute(), false);
});

test('a null element registers nothing and returns no cleanup', () => {
  const probe = pauseAnimationsWhenOffscreen(fakeElement().element);
  const observer = FakeObserver.created.at(-1);
  assert.ok(observer !== undefined);
  probe?.();
  const before = observer.observed.size;

  const cleanup = pauseAnimationsWhenOffscreen(null);
  assert.equal(cleanup, undefined);
  assert.equal(observer.observed.size, before);
});

test('every element shares one observer for the whole app', () => {
  const first = fakeElement();
  const second = fakeElement();
  const probe = pauseAnimationsWhenOffscreen(fakeElement().element);
  probe?.();
  const instanceCount = FakeObserver.created.length;

  const cleanupFirst = pauseAnimationsWhenOffscreen(first.element);
  pauseAnimationsWhenOffscreen(second.element);

  assert.equal(FakeObserver.created.length, instanceCount);
  const observer = FakeObserver.created.at(-1);
  assert.ok(observer !== undefined);
  assert.ok(observer.observed.has(first.element));
  assert.ok(observer.observed.has(second.element));

  cleanupFirst?.();
});
