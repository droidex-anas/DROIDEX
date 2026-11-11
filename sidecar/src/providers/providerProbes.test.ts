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

test('a refresh during a round is answered by one fresh round after it', async () => {
  const answers: ((status: ProviderStatus) => void)[] = [];
  const probes = new ProviderProbes(
    new Map<ProviderKind, ProviderProbe>([
      [
        'codex',
        () =>
          new Promise((resolve) => {
            answers.push(resolve);
          }),
      ],
    ]),
  );

  const first = probes.refresh();
  // Codex finishes installing while the first round still waits on the old answer.
  const afterInstall = probes.refresh();
  const alongside = probes.refresh();
  answers[0]?.({ provider: 'codex', readiness: 'missing', models: [] });
  await first;
  await new Promise<void>((resolve) => setImmediate(resolve));
  answers[1]?.({ provider: 'codex', readiness: 'ready', models: [] });
  await Promise.all([afterInstall, alongside]);
  assert.equal(probes.status('codex')?.readiness, 'ready');
  assert.equal(answers.length, 2);
});

test('shutdown drops the round a refresh queued', async () => {
  let probed = 0;
  const probes = new ProviderProbes(
    new Map<ProviderKind, ProviderProbe>([
      [
        'codex',
        (signal) => {
          probed += 1;
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          });
        },
      ],
    ]),
  );

  const first = probes.refresh();
  const queued = probes.refresh();
  probes.cancel();
  await Promise.all([first, queued]);
  assert.equal(probed, 1);
});
