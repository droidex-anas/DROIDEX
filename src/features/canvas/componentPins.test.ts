import assert from 'node:assert/strict';
import test from 'node:test';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';
import {
  componentLabels,
  componentPins,
  pinsUnderKit,
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
  // Choosing it again from a later version of the kit moves the tag there.
  tagComponent('chat-a', pin('Button', { ...ACME, version: 4 }));
  assert.deepEqual(componentPins('chat-a'), [pin('Button', { ...ACME, version: 4 })]);
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
test('tags of the request’s kit follow it to its current version and mode', () => {
  const slate = pin('Card', { id: 'slate', version: 1, mode: 'dark' }, 'Slate');
  const pins = [pin('Button'), slate];
  const current = { ...ACME, version: 4, mode: 'dark' as const };
  assert.deepEqual(pinsUnderKit(pins, current), [pin('Button', current), slate]);
  assert.equal(pinsUnderKit(pins, ACME), pins);
  assert.equal(pinsUnderKit(pins, null), pins);
});
