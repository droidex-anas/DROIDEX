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

async function saveBooleanPreference(options) {
  const temporaryPath = `${options.filePath}.${crypto.randomUUID()}.tmp`;
  await options.fs.mkdir(path.dirname(options.filePath), { recursive: true, mode: 0o700 });
  try {
    await options.fs.writeFile(
      temporaryPath,
      `${JSON.stringify({ version: 1, enabled: options.enabled }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await options.fs.rename(temporaryPath, options.filePath);
  } catch (error) {
    try {
      await options.fs.unlink(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

module.exports = { loadBooleanPreference, saveBooleanPreference };
