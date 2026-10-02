import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissSidebarCard, loadSidebarCardSeen } from './sidebarCards';
import { withLocalStorageMap } from '../test/localStorage';

test('dismissing a card persists the seen flag for that card id only', () => {
  withLocalStorageMap({}, () => {
    // An unseen card reports not seen so it can show on launch.
    assert.equal(loadSidebarCardSeen('welcome-to-droidex'), false);
    dismissSidebarCard('welcome-to-droidex');
    assert.equal(loadSidebarCardSeen('welcome-to-droidex'), true);
    // Dismissal is scoped per card id so a new announcement still shows.
    assert.equal(loadSidebarCardSeen('update-2-notes'), false);
  });
});

test('storage failures stay quiet and report seen', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    },
  });
  try {
    assert.equal(loadSidebarCardSeen('welcome-to-droidex'), true);
    dismissSidebarCard('welcome-to-droidex');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
