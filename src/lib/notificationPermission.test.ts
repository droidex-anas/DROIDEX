import test from 'node:test';
import assert from 'node:assert/strict';
import { requestNotificationPermission } from './notificationPermission';

function replaceNotification(value: unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Notification');
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, 'Notification', descriptor);
    else Reflect.deleteProperty(globalThis, 'Notification');
  };
}

test('an existing decision is returned without prompting; otherwise the prompt decides', async () => {
  const failingPrompt = async () => {
    throw new Error('permission request failed');
  };
  // [why, API present, current permission, prompt answer, expected result, prompts?]
  const cases: Array<[string, boolean, string, () => Promise<string>, string, boolean]> = [
    ['already granted', true, 'granted', async () => 'default', 'granted', false],
    ['already denied', true, 'denied', async () => 'default', 'denied', false],
    ['prompt denies', true, 'default', async () => 'denied', 'denied', true],
    ['prompt dismissed', true, 'default', async () => 'default', 'default', true],
    ['prompt rejects', true, 'default', failingPrompt, 'unsupported', true],
    ['no Notification API', false, 'default', async () => 'default', 'unsupported', false],
  ];
  for (const [why, supported, permission, answer, expected, prompts] of cases) {
    let prompted = false;
    const requestPermission = () => {
      prompted = true;
      return answer();
    };
    const restore = replaceNotification(supported ? { permission, requestPermission } : undefined);
    try {
      assert.equal(await requestNotificationPermission(), expected, why);
      assert.equal(prompted, prompts, why);
    } finally {
      restore();
    }
  }
});
