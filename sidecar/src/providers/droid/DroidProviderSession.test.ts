import assert from 'node:assert/strict';
import test from 'node:test';

import type { FactorySession } from '../../DroidRuntime.js';
import type { NormalizedEvent } from '../../normalize.js';
import { successfulResultEvent } from '../../testing/fakeFactoryRuntime.js';
import { UsageLimitError } from '../usageLimit.js';
import { DroidProviderSession } from './DroidProviderSession.js';

type RawListener = (note: Record<string, unknown>) => void;

// The Droid CLI as the session sees it: a turn's raw notifications reach the
// listeners before the stream yields, and every turn ends in a successful result.
function droidOn(modelId: string) {
  const listeners = new Set<RawListener>();
  const cli = {
    turn: (): unknown => undefined,
    onSettingsWrite: (): void => undefined,
    notify(notification: Record<string, unknown>): void {
      for (const listener of listeners)
        listener({ method: 'droid.session_notification', params: { notification } });
    },
  };
  const droid = {
    sessionId: 'droid-1',
    initResult: { settings: { modelId } },
    onNotification(listener: RawListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateSettings() {
      cli.onSettingsWrite();
      return Promise.resolve({});
    },
    async *stream() {
      await cli.turn();
      yield successfulResultEvent('droid-1');
    },
  } as unknown as FactorySession;
  const runtime = {
    processIdOf: () => undefined,
    isProcessAlive: () => false,
    factoryApiKey: () => undefined,
  };
  return { cli, session: new DroidProviderSession('app-1', droid, runtime) };
}

const settingsUpdated = (modelId: string) => ({ type: 'settings_updated', settings: { modelId } });
const systemNotice = (text: string) => ({
  type: 'create_message',
  message: { role: 'system', visibility: 'user_only', content: [{ type: 'text', text }] },
});

async function turnEvents(turn: AsyncGenerator<NormalizedEvent>): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of turn) events.push(event);
  return events;
}

const switches = (events: NormalizedEvent[]) =>
  events.flatMap((event) => (event.harnessModelSwitch ? [event.harnessModelSwitch] : []));

test('a switch Droid makes on the usage limit is reported once, and never for our own write', async () => {
  const { cli, session } = droidOn('opus-5-5');
  cli.turn = () => {
    cli.notify(settingsUpdated('kimi-k2-7-core'));
    cli.notify(
      systemNotice(
        'Your standard model budget is exhausted. You have been switched to Kimi K2.7 Code (Droid Core) to continue this session as per your overage preference. To set your preferences, run the `/limits` slash command.',
      ),
    );
  };
  assert.deepEqual(switches(await turnEvents(session.stream('go on'))), [
    { from: 'opus-5-5', to: 'kimi-k2-7-core', cause: 'usage_limit' },
  ]);

  // A switch crossing DROIDEX's own write lands while the write is in flight,
  // ahead of the write's echo; the write decides the model.
  cli.onSettingsWrite = () => {
    cli.notify(settingsUpdated('glm-5-core'));
    cli.notify(settingsUpdated('sonnet-5'));
  };
  cli.turn = () => session.setModel({ modelId: 'sonnet-5' });
  assert.deepEqual(switches(await turnEvents(session.stream('and again'))), []);
});

test('a translated limit notice fails the turn with its detail and adds no row', async () => {
  const { cli, session } = droidOn('opus-5-5');
  cli.turn = () => {
    cli.notify(
      systemNotice(
        "Hai raggiunto il limite di utilizzo settimanale.\nQuesto viene ricontrollato a ogni messaggio, quindi se il tuo limite è stato aumentato o è stato reimpostato, invia un altro messaggio per continuare. Esegui `/limits` per vedere l'utilizzo.",
      ),
    );
  };
  const events: NormalizedEvent[] = [];
  await assert.rejects(
    async () => {
      for await (const event of session.stream('go on')) events.push(event);
    },
    (error) =>
      error instanceof UsageLimitError &&
      error.message === 'Hai raggiunto il limite di utilizzo settimanale.',
  );
  assert.deepEqual(
    events.filter((event) => event.transcript),
    [],
  );
});
