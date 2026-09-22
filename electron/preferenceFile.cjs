const crypto = require('node:crypto');
const path = require('node:path');

// Boolean opt-in/opt-out preferences (diagnostics, usage analytics) all persist
// the same way: a versioned JSON file in userData, written atomically with
// owner-only permissions so a half-written file can never read as consent.

async function loadBooleanPreference(options) {
  const fallback = options.fallback;
  try {
    const parsed = JSON.parse(await options.fs.readFile(options.filePath, 'utf8'));
    if (parsed?.version === 1 && typeof parsed.enabled === 'boolean') {
      return { enabled: parsed.enabled };
    }
    throw new Error(options.invalidMessage);
  } catch (error) {
    if (error?.code === 'ENOENT') return { enabled: fallback };
    throw error;
  }
}

function saveBooleanPreference(options) {
  return writeJsonFile(options.fs, options.filePath, { version: 1, enabled: options.enabled });
}

// Writes through a temporary file and a rename, with owner-only permissions, so
// a crash mid-write can never leave a truncated file behind.
async function writeJsonFile(fileSystem, filePath, value) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fileSystem.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    await fileSystem.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    await fileSystem.rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await fileSystem.unlink(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

module.exports = { loadBooleanPreference, saveBooleanPreference, writeJsonFile };
