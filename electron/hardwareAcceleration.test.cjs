const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const {
  HARDWARE_ACCELERATION_DEFAULT,
  loadHardwareAccelerationPreference,
  parseHardwareAccelerationPreference,
  preferenceFilePath,
  readHardwareAccelerationPreferenceSync,
  saveHardwareAccelerationPreference,
} = require('./hardwareAcceleration.cjs');

test('a missing, empty, or malformed preference file starts with hardware acceleration enabled', () => {
  assert.deepEqual(
    readHardwareAccelerationPreferenceSync({
      filePath: '/tmp/missing-hardware-acceleration.json',
      fs: {
        readFileSync() {
          const error = new Error('missing');
          error.code = 'ENOENT';
          throw error;
        },
      },
    }),
    { enabled: HARDWARE_ACCELERATION_DEFAULT },
  );

  const cases = ['', '   ', '{broken', '{"version":2,"enabled":false}', '{"enabled":true}'];
  for (const raw of cases) {
    assert.deepEqual(
      readHardwareAccelerationPreferenceSync({
        filePath: '/tmp/invalid-hardware-acceleration.json',
        fs: { readFileSync: () => raw },
      }),
      { enabled: true },
    );
  }
  assert.equal(
    parseHardwareAccelerationPreference('{"version":1,"enabled":false}')?.enabled,
    false,
  );
});

test('settings writes round-trip through the same reader main uses at startup', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'droidex-hardware-acceleration-'));
  const filePath = preferenceFilePath(dir);
  const fs = require('node:fs/promises');

  await saveHardwareAccelerationPreference({ filePath, enabled: false, fs });
  assert.deepEqual(await loadHardwareAccelerationPreference({ filePath, fs }), { enabled: false });
  assert.deepEqual(readHardwareAccelerationPreferenceSync({ filePath }), { enabled: false });

  await saveHardwareAccelerationPreference({ filePath, enabled: true, fs });
  const raw = await readFile(filePath, 'utf8');
  assert.deepEqual(JSON.parse(raw), { version: 1, enabled: true });
  assert.deepEqual(readHardwareAccelerationPreferenceSync({ filePath }), { enabled: true });
});

test('startup falls back and settings fail closed on the same corrupt file', async () => {
  const raw = '{broken';
  const filePath = '/tmp/corrupt-hardware-acceleration.json';
  assert.deepEqual(
    readHardwareAccelerationPreferenceSync({
      filePath,
      fs: { readFileSync: () => raw },
    }),
    { enabled: HARDWARE_ACCELERATION_DEFAULT },
  );
  await assert.rejects(
    () =>
      loadHardwareAccelerationPreference({
        filePath,
        fs: { readFile: async () => raw },
      }),
    /Hardware acceleration preference is invalid\. Toggle it again in Settings\./,
  );
});
