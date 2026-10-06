import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  getHardwareAcceleration,
  isHardwareAccelerationSettingAvailable,
  setHardwareAcceleration,
} from '../lib/hardwareAcceleration.js';
import { HardwareAccelerationSetting } from './HardwareAccelerationSetting.js';

const g = globalThis as { window?: { droidControl?: Record<string, unknown> } };

afterEach(() => {
  delete g.window;
});

test('without the desktop bridge the setting is absent and the bridge rejects', async () => {
  assert.equal(renderToStaticMarkup(createElement(HardwareAccelerationSetting)), '');
  assert.equal(isHardwareAccelerationSettingAvailable(), false);
  await assert.rejects(getHardwareAcceleration, /only available in the DROIDEX app/i);
  await assert.rejects(() => setHardwareAcceleration(false), /only available in the DROIDEX app/i);
});

test('with the desktop bridge the setting states its restart and reads the saved preference', async () => {
  g.window = {
    droidControl: {
      getHardwareAcceleration: async () => ({ enabled: false }),
      setHardwareAcceleration: async (enabled: boolean) => ({ enabled }),
      relaunchApp: async () => undefined,
    },
  };

  const html = renderToStaticMarkup(createElement(HardwareAccelerationSetting));
  assert.match(html, /aria-label="Hardware acceleration"/);
  assert.match(html, /Changes take effect after you restart DROIDEX/);
  assert.deepEqual(await getHardwareAcceleration(), { enabled: false });
  assert.deepEqual(await setHardwareAcceleration(true), { enabled: true });
});
