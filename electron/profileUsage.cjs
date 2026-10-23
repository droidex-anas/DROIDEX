const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

function createProfileUsage(options) {
  const request = options.fetch ?? globalThis.fetch;
  if (typeof request !== 'function') throw new Error('Profile usage requires fetch support.');

  async function snapshot() {
    const bridge = await options.bridgeInfo();
    if (
      !bridge ||
      !Number.isInteger(bridge.port) ||
      bridge.port < 1 ||
      bridge.port > 65_535 ||
      typeof bridge.token !== 'string' ||
      bridge.token.length === 0
    ) {
      throw new Error('Profile usage could not connect to the local DROIDEX service.');
    }
    const response = await request(`http://127.0.0.1:${String(bridge.port)}/profile/usage`, {
      method: 'GET',
      headers: { authorization: `Bearer ${bridge.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(
        response.status === 503
          ? 'Local usage is unavailable. Restart DROIDEX and review the usage database.'
          : 'Profile usage could not be read from the local DROIDEX service.',
      );
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
      throw new Error('The local usage response exceeded its safety limit.');
    }
    let value;
    try {
      value = JSON.parse(body);
    } catch {
      throw new Error('The local DROIDEX service returned invalid usage data.');
    }
    if (!validSnapshot(value)) {
      throw new Error('The local DROIDEX service returned invalid usage data.');
    }
    return value;
  }

  return {
    snapshot,
    registerIpc(desktopIpc) {
      desktopIpc.handle('profile-usage-get', () => snapshot());
    },
  };
}

function validSnapshot(value) {
  return (
    value &&
    typeof value === 'object' &&
    validSync(value.sync) &&
    count(value.lifetimeTokens) &&
    count(value.peakDayTokens) &&
    count(value.sessions) &&
    count(value.currentStreak) &&
    count(value.longestStreak) &&
    count(value.trackingSince) &&
    Array.isArray(value.days) &&
    value.days.length <= 366 &&
    Array.isArray(value.harnesses) &&
    value.harnesses.length <= 32 &&
    Array.isArray(value.models) &&
    value.models.length <= 256 &&
    (value.mostUsedHarness === null || typeof value.mostUsedHarness === 'string') &&
    value.totals &&
    typeof value.totals === 'object' &&
    count(value.totals.events) &&
    value.coverage &&
    typeof value.coverage === 'object' &&
    typeof value.timeZone === 'string' &&
    value.timeZone.length > 0 &&
    value.timeZone.length <= 80
  );
}

function validSync(value) {
  if (!value || typeof value !== 'object' || !value.sources || typeof value.sources !== 'object')
    return false;
  const states = [value.sources.jsonl, value.sources.openCode, value.sources.droid];
  if (!states.every(syncState)) return false;
  const status = states.includes('error')
    ? 'error'
    : states.every((state) => state === 'ready')
      ? 'ready'
      : 'indexing';
  return value.status === status;
}

function syncState(value) {
  return value === 'indexing' || value === 'ready' || value === 'error';
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

module.exports = { createProfileUsage };
