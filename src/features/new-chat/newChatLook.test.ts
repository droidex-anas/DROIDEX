import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNewChatLook, updateNewChatLook } from './newChatLook';

const stored = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  },
});

const IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

test('an uploaded background stays chosen only while its image is stored', () => {
  updateNewChatLook({ backgroundImage: IMAGE, backdrop: 'custom' });
  assert.equal(loadNewChatLook().backdrop, 'custom');
  assert.equal(loadNewChatLook().backgroundImage, IMAGE);

  updateNewChatLook({ backgroundImage: null });
  assert.equal(loadNewChatLook().backdrop, 'glow');
  assert.equal(loadNewChatLook().backgroundImage, null);
});

test('a stored choice that no longer holds falls back to the default look', () => {
  stored.set('droid-new-chat-look', JSON.stringify({ backdrop: 'custom', logo: 'sparkles' }));
  stored.delete('droid-new-chat-background-image');
  assert.equal(loadNewChatLook().backdrop, 'glow');
  assert.equal(loadNewChatLook().logo, 'harness');

  stored.set('droid-new-chat-look', '{not json');
  assert.equal(loadNewChatLook().backdrop, 'glow');
});
