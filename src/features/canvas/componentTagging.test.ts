import assert from 'node:assert/strict';
import test from 'node:test';
import { componentPins, type ComponentPin } from './componentPins';
import { toggleComponentPin } from './componentTagging';

const ACME = { id: 'acme', version: 3, mode: 'light' as const };

function pin(name: string, kit = ACME, props: ComponentPin['props'] = []): ComponentPin {
  return { kit, kitName: 'Acme', name, props };
}

test('the Tag in chat toggle takes off its own options, and swaps in its options for others', () => {
  const outline = pin('Button', ACME, [{ name: 'variant', value: 'outline' }]);
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
  toggleComponentPin('chat-o', pin('Button', ACME, [variant, size]));
  toggleComponentPin('chat-o', pin('Button', { ...ACME, version: 4 }, [size, variant]));
  assert.equal(componentPins('chat-o').length, 0);
});
