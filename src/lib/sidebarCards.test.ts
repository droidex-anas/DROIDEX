import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissSidebarCard, loadSidebarCardSeen } from './sidebarCards';
import { withFailingLocalStorage, withLocalStorageMap } from '../test/localStorage';

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
  withFailingLocalStorage(() => {
    assert.equal(loadSidebarCardSeen('welcome-to-droidex'), true);
    dismissSidebarCard('welcome-to-droidex');
  });
});
