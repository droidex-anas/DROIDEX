import assert from 'node:assert/strict';
import test from 'node:test';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';
import {
  componentLabels,
  componentPins,
  restoreComponentPins,
  tagComponent,
  unpinComponents,
  type ComponentPin,
} from './componentPins';

const ACME = { id: 'acme', version: 3, mode: 'light' as const };

function pin(name: string, kit = ACME, kitName = 'Acme'): ComponentPin {
  return { kit, kitName, name };
}

test('a component is tagged once per kit, by the chat that tagged it, up to eight', () => {
  let shown: ToastItem[] = [];
  const stopWatching = subscribeToasts((toasts) => {
    shown = toasts;
  });
  tagComponent('chat-a', pin('Button'));
  // A later version of the kit names the same entry.
  tagComponent('chat-a', pin('Button', { ...ACME, version: 4 }));
  assert.deepEqual(
    componentPins('chat-a').map((each) => each.name),
    ['Button'],
  );
  assert.equal(componentPins('chat-b').length, 0);

  for (let index = 0; index < 8; index += 1) tagComponent('chat-a', pin(`Card ${String(index)}`));
  assert.equal(componentPins('chat-a').length, 8);
  assert.equal(componentPins('chat-a').at(-1)?.name, 'Card 6');
  assert.deepEqual(
    shown.map((item) => item.message),
    ['A prompt tags at most 8 components, so this one wasn’t added.'],
  );
  for (const item of shown) dismissToast(item.id);
  stopWatching();

  unpinComponents('chat-a', [pin('Button')]);
  assert.equal(componentPins('chat-a')[0]?.name, 'Card 0');
  unpinComponents('chat-a');
  assert.equal(componentPins('chat-a').length, 0);
});

test('an edited queued prompt brings its components back beside the draft’s, as far as it has room', () => {
  tagComponent('chat-q', pin('Button'));
  const queued = [pin('Button'), ...Array.from({ length: 8 }, (_, i) => pin(`Card ${String(i)}`))];
  restoreComponentPins('chat-q', queued);
  assert.deepEqual(
    componentPins('chat-q').map((each) => each.name),
    ['Button', ...Array.from({ length: 7 }, (_, i) => `Card ${String(i)}`)],
  );
  unpinComponents('chat-q');
});

test('a chip names its kit only beside components of another kit', () => {
  assert.deepEqual(componentLabels([pin('Button'), pin('Card')]), ['Button', 'Card']);
  const slate = { id: 'slate', version: 1, mode: 'dark' as const };
  assert.deepEqual(componentLabels([pin('Button'), pin('Card', slate, 'Slate')]), [
    'Button · Acme',
    'Card · Slate',
  ]);
});
