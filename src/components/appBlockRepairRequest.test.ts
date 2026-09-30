import assert from 'node:assert/strict';
import test from 'node:test';
import { requestAppBlockRepair } from './appBlockRepairRequest';

test('repair sends only after preparation', async () => {
  const calls: string[] = [];
  await requestAppBlockRepair({
    canSend: () => true,
    prepare: async () => {
      calls.push('prepare');
    },
    send: () => {
      calls.push('send');
    },
  });
  assert.deepEqual(calls, ['prepare', 'send']);
});

test('repair does not send if the conversation becomes unavailable while preparing', async () => {
  let allowed = true;
  let finishPreparation = () => {};
  const preparation = new Promise<void>((resolve) => {
    finishPreparation = resolve;
  });
  const request = requestAppBlockRepair({
    canSend: () => allowed,
    prepare: () => preparation,
    send: () => assert.fail('Must not send to a switched, closed, or busy session'),
  });
  allowed = false;
  finishPreparation();
  await assert.rejects(request, /chat changed/);
});

test('repair declines unavailable sessions and propagates preparation and send failures', async () => {
  await assert.rejects(
    requestAppBlockRepair({
      canSend: () => false,
      prepare: async () => assert.fail('Must not prepare'),
      send: () => assert.fail('Must not send'),
    }),
    /not ready yet/,
  );
  await assert.rejects(
    requestAppBlockRepair({
      canSend: () => true,
      prepare: async () => {
        throw new Error('Baseline unavailable');
      },
      send: () => assert.fail('Must not send'),
    }),
    /Baseline unavailable/,
  );
  await assert.rejects(
    requestAppBlockRepair({
      canSend: () => true,
      prepare: async () => {},
      send: () => {
        throw new Error('Connection unavailable');
      },
    }),
    /Connection unavailable/,
  );
});
