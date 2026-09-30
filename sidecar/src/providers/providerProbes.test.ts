import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderStatus } from '../protocol.js';
import type { ProviderKind } from './providerKind.js';
import { ProviderProbes, type ProviderProbe } from './providerProbes.js';

test('a provider that answers is announced while its sibling is still probing', async () => {
  let answerCodex: (status: ProviderStatus) => void = () => undefined;
  const announced: ProviderKind[] = [];
  const probes = new ProviderProbes(
    new Map<ProviderKind, ProviderProbe>([
      ['claude', () => Promise.resolve({ provider: 'claude', readiness: 'ready', models: [] })],
      [
        'codex',
        () =>
          new Promise((resolve) => {
            answerCodex = resolve;
          }),
      ],
    ]),
    (provider) => announced.push(provider),
  );

  const round = probes.refresh();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(announced, ['claude']);
  assert.equal(probes.status('claude')?.readiness, 'ready');
  assert.equal(probes.status('codex'), undefined);

  answerCodex({ provider: 'codex', readiness: 'ready', models: [] });
  await round;
  assert.deepEqual(announced, ['claude', 'codex']);
});
