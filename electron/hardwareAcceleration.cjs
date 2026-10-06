const path = require('node:path');
const { writeJsonFile } = require('./preferenceFile.cjs');

const PREFERENCE_VERSION = 1;
const HARDWARE_ACCELERATION_DEFAULT = true;
const PREFERENCE_FILENAME = 'hardware-acceleration-preferences.json';

function preferenceFilePath(userDataDir) {
  return path.join(userDataDir, PREFERENCE_FILENAME);
}

function parseHardwareAccelerationPreference(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === PREFERENCE_VERSION && typeof parsed.enabled === 'boolean') {
      return { enabled: parsed.enabled };
    }
  } catch {
    // Corrupt JSON is the same as an unrecognized preference document.
  }
  return null;
}

function readHardwareAccelerationPreferenceSync(options) {
  const fs = options.fs ?? require('node:fs');
  try {
    const preference = parseHardwareAccelerationPreference(
      fs.readFileSync(options.filePath, 'utf8'),
    );
    if (preference) return preference;
  } catch {
    // Missing, empty, or malformed preferences fall back to the default.
  }
  return { enabled: HARDWARE_ACCELERATION_DEFAULT };
}

async function loadHardwareAccelerationPreference(options) {
  try {
    const preference = parseHardwareAccelerationPreference(
      await options.fs.readFile(options.filePath, 'utf8'),
    );
    if (preference) return preference;
    throw new Error('Hardware acceleration preference is invalid. Toggle it again in Settings.');
  } catch (error) {
    if (error?.code === 'ENOENT') return { enabled: HARDWARE_ACCELERATION_DEFAULT };
    throw error;
  }
}

async function saveHardwareAccelerationPreference(options) {
  if (typeof options.enabled !== 'boolean') {
    throw new Error('Hardware acceleration preference must be boolean.');
  }
  await writeJsonFile(options.fs, options.filePath, {
    version: PREFERENCE_VERSION,
    enabled: options.enabled,
  });
  return { enabled: options.enabled };
}

module.exports = {
  HARDWARE_ACCELERATION_DEFAULT,
  loadHardwareAccelerationPreference,
  parseHardwareAccelerationPreference,
  preferenceFilePath,
  readHardwareAccelerationPreferenceSync,
  saveHardwareAccelerationPreference,
};
