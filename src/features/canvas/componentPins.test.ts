import assert from 'node:assert/strict';
import test from 'node:test';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';
import {
  componentLabels,
  componentPins,
  pinsUnderKit,
  restoreComponentPins,
  tagComponent,
  toggleComponentPin,
  unpinComponents,
  unpinSentComponents,
  type ComponentPin,
} from './componentPins';

const ACME = { id: 'acme', version: 3, mode: 'light' as const };

function pin(
  name: string,
  kit = ACME,
  kitName = 'Acme',
  props: ComponentPin['props'] = [],
): ComponentPin {
  return { kit, kitName, name, props };
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

test('the Tag in chat toggle takes off its own options, and swaps in its options for others', () => {
  const outline = pin('Button', ACME, 'Acme', [{ name: 'variant', value: 'outline' }]);
  toggleComponentPin('chat-t', pin('Button'));
  toggleComponentPin('chat-t', outline);
  assert.deepEqual(componentPins('chat-t'), [outline]);
  // A later kit version is the same entry, so the toggle takes it off.
  toggleComponentPin('chat-t', { ...outline, kit: { ...ACME, version: 4 } });
  assert.equal(componentPins('chat-t').length, 0);
});

test('the toggle takes off the same options when a later kit version lists the props in another order', () => {
  const variant = { name: 'variant', value: 'outline' };
  const size = { name: 'size', value: 'lg' };
  toggleComponentPin('chat-o', pin('Button', ACME, 'Acme', [variant, size]));
  toggleComponentPin('chat-o', pin('Button', { ...ACME, version: 4 }, 'Acme', [size, variant]));
  assert.equal(componentPins('chat-o').length, 0);
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
  // The queued tag takes the place of the draft's tag of the same entry.
  tagComponent('chat-q', pin('Button', { ...ACME, version: 4 }));
  restoreComponentPins('chat-q', [pin('Button')]);
  assert.deepEqual(componentPins('chat-q'), [pin('Button')]);
  unpinComponents('chat-q');
});

test('a sent prompt takes off only the tags it was composed with, not a tag made again since', () => {
  tagComponent('chat-s', pin('Button'));
  tagComponent('chat-s', pin('Card'));
  const sent = componentPins('chat-s');
  tagComponent('chat-s', pin('Button', { ...ACME, version: 4 }));
  unpinSentComponents('chat-s', sent);
  assert.deepEqual(componentPins('chat-s'), [pin('Button', { ...ACME, version: 4 })]);
  unpinComponents('chat-s');
});

test('a chip names its picked options, and its kit only beside components of another kit', () => {
  const outline = pin('Button', ACME, 'Acme', [
    { name: 'variant', value: 'outline' },
    { name: 'size', value: 'lg' },
  ]);
  assert.deepEqual(componentLabels([outline, pin('Card')]), ['Button (outline, lg)', 'Card']);
  const slate = { id: 'slate', version: 1, mode: 'dark' as const };
  assert.deepEqual(componentLabels([pin('Button'), pin('Card', slate, 'Slate')]), [
    'Button · Acme',
    'Card · Slate',
  ]);
});
test('tags of the request’s kit follow it to its current version, mode and name', () => {
  const slate = pin('Card', { id: 'slate', version: 1, mode: 'dark' }, 'Slate');
  const pins = [pin('Button'), slate];
  const current = { ...ACME, version: 4, mode: 'dark' as const };
  assert.deepEqual(pinsUnderKit(pins, current, null, null), [pin('Button', current), slate]);
  const renamed = { ref: current, name: 'Acme 2' };
  assert.deepEqual(pinsUnderKit(pins, current, renamed, null), [
    pin('Button', current, 'Acme 2'),
    slate,
  ]);
  assert.equal(pinsUnderKit(pins, ACME, { ref: ACME, name: 'Acme' }, null), pins);
  assert.equal(pinsUnderKit(pins, null, null, null), pins);
});

test('a tag that follows its kit to a new version keeps only the options that version offers', () => {
  const picks = [
    { name: 'variant', value: 'outline' },
    { name: 'size', value: 'xl' },
  ];
  const current = { ...ACME, version: 4 };
  const catalog = [
    {
      name: 'Button',
      module: null,
      note: null,
      props: [
        { name: 'variant', options: ['default', 'outline'], default: 'default' },
        { name: 'size', options: ['sm', 'lg'], default: 'sm' },
      ],
    },
  ];
  assert.deepEqual(pinsUnderKit([pin('Button', ACME, 'Acme', picks)], current, null, catalog), [
    pin('Button', current, 'Acme', [picks[0]]),
  ]);
});
