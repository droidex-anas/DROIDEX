import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addSavedBackground,
  loadNewChatLook,
  MAX_SAVED_BACKGROUNDS,
  removeSavedBackground,
} from './newChatLook';

const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  },
});

const IMAGE = 'data:image/jpeg;base64,/9j/4AAQ';

test('added images are kept as backgrounds until removed', () => {
  addSavedBackground(IMAGE);
  addSavedBackground(`${IMAGE}2`);
  const look = loadNewChatLook();
  const [first, second] = look.savedBackgrounds;
  assert.equal(look.savedBackgrounds.length, 2);
  assert.equal(look.backdrop, second.id);

  removeSavedBackground(second.id);
  assert.deepEqual(
    loadNewChatLook().savedBackgrounds.map((background) => background.id),
    [first.id],
  );
  assert.equal(loadNewChatLook().backdrop, 'glow');
  removeSavedBackground(first.id);
  assert.equal([...stored.keys()].filter((key) => key.includes('background:')).length, 0);
});

test('a full set of backgrounds refuses another, and a failed write saves nothing', () => {
  for (let index = 0; index < MAX_SAVED_BACKGROUNDS; index++) addSavedBackground(IMAGE);
  assert.throws(() => {
    addSavedBackground(IMAGE);
  });
  for (const background of loadNewChatLook().savedBackgrounds) removeSavedBackground(background.id);

  const setItem = stored.set.bind(stored);
  stored.set = () => {
    throw new Error('QuotaExceededError');
  };
  assert.throws(() => {
    addSavedBackground(IMAGE);
  });
  stored.set = setItem;
  assert.equal(loadNewChatLook().savedBackgrounds.length, 0);
});

test('a stored choice that no longer holds falls back to the default look', () => {
  stored.set(
    'droid-new-chat-look',
    JSON.stringify({ backdrop: 'image-gone', logo: 'custom', savedBackgroundIds: ['image-gone'] }),
  );
  assert.equal(loadNewChatLook().backdrop, 'glow');
  assert.equal(loadNewChatLook().logo, 'harness');
  assert.equal(loadNewChatLook().savedBackgrounds.length, 0);

  stored.set('droid-new-chat-look', '{not json');
  assert.equal(loadNewChatLook().backdrop, 'glow');
});
