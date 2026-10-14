const path = require('node:path');
const { writeJsonFile } = require('./preferenceFile.cjs');

const MAX_SESSIONS = 10_000;
const MAX_DAYS = 366;
const PROVIDERS = new Set(['droid', 'claude', 'codex']);
const HARNESS_NAMES = { droid: 'Droid', claude: 'Claude Code', codex: 'Codex' };

function dayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateRecord(record) {
  if (
    !record ||
    typeof record.id !== 'string' ||
    record.id.length === 0 ||
    record.id.length > 160 ||
    !PROVIDERS.has(record.provider) ||
    (record.modelId !== undefined &&
      (typeof record.modelId !== 'string' || record.modelId.length > 160)) ||
    !validCount(record.tokens) ||
    !Number.isFinite(record.createdAt) ||
    record.createdAt < 0 ||
    record.createdAt > 8_640_000_000_000_000
  ) {
    throw new Error('Profile usage record is invalid.');
  }
}

function previousDay(date) {
  const previous = new Date(`${date}T12:00:00`);
  previous.setDate(previous.getDate() - 1);
  return dayKey(previous.getTime());
}

function ranking(records, nameOf) {
  const counts = new Map();
  for (const record of records.values()) {
    const name = nameOf(record);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, sessions]) => ({ name, sessions }))
    .sort((left, right) => right.sessions - left.sessions || left.name.localeCompare(right.name))
    .slice(0, 5);
}

// Counts stay on this laptop. Initial historical totals are a baseline, never
// assigned to a day; only later observed increases enter the activity chart.
function createProfileUsage({ userDataDir, fs, now = Date.now }) {
  const filePath = path.join(userDataDir, 'profile-usage.json');
  let records = new Map();
  let days = new Map();
  let trackingSince;
  let longestStreak = 0;
  let peakDayTokens = 0;
  let lastActiveDay = '';
  let streakLength = 0;
  let loaded = false;
  let dirty = false;
  let queue = Promise.resolve();

  async function load() {
    if (loaded) return;
    try {
      const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (
        stored?.version !== 1 ||
        !validCount(stored.trackingSince) ||
        !validCount(stored.longestStreak) ||
        !validCount(stored.peakDayTokens) ||
        typeof stored.lastActiveDay !== 'string' ||
        !validCount(stored.streakLength) ||
        !Array.isArray(stored.records) ||
        stored.records.length > MAX_SESSIONS ||
        !Array.isArray(stored.days) ||
        stored.days.length > MAX_DAYS
      )
        throw new Error('Profile usage file is invalid.');
      for (const record of stored.records) validateRecord(record);
      for (const day of stored.days) {
        if (
          !day ||
          !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
          !validCount(day.tokens) ||
          day.tokens === 0
        ) {
          throw new Error('Profile usage file is invalid.');
        }
      }
      records = new Map(stored.records.map((record) => [record.id, record]));
      days = new Map(stored.days.map((day) => [day.date, day.tokens]));
      trackingSince = stored.trackingSince;
      longestStreak = stored.longestStreak;
      peakDayTokens = stored.peakDayTokens;
      lastActiveDay = stored.lastActiveDay;
      streakLength = stored.streakLength;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new Error(
          'Could not read local profile usage. Restore or remove profile-usage.json in the app data directory.',
          { cause: error },
        );
      }
      trackingSince = now();
    }
    loaded = true;
  }

  async function flush() {
    if (!dirty) return;
    await writeJsonFile(fs, filePath, {
      version: 1,
      trackingSince,
      longestStreak,
      peakDayTokens,
      lastActiveDay,
      streakLength,
      records: [...records.values()],
      days: [...days].map(([date, tokens]) => ({ date, tokens })),
    });
    dirty = false;
  }

  function enqueue(action) {
    const result = queue.then(action);
    queue = result.catch(() => undefined);
    return result;
  }

  return {
    record(incoming) {
      return enqueue(async () => {
        if (!Array.isArray(incoming) || incoming.length > MAX_SESSIONS) {
          throw new Error('Profile usage batch is invalid.');
        }
        for (const record of incoming) validateRecord(record);
        await load();
        const newIds = new Set(
          incoming.filter((record) => !records.has(record.id)).map((record) => record.id),
        );
        if (records.size + newIds.size > MAX_SESSIONS)
          throw new Error('Local profile usage has reached its 10,000-chat limit.');
        const today = dayKey(now());
        for (const incomingRecord of incoming) {
          const prior = records.get(incomingRecord.id);
          const tokens = Math.max(prior?.tokens ?? 0, incomingRecord.tokens);
          const delta = prior
            ? tokens - prior.tokens
            : incomingRecord.createdAt >= trackingSince
              ? tokens
              : 0;
          const record = {
            id: incomingRecord.id,
            provider: incomingRecord.provider,
            ...(incomingRecord.modelId ? { modelId: incomingRecord.modelId } : {}),
            tokens,
            createdAt: incomingRecord.createdAt,
          };
          if (prior && prior.tokens === tokens && prior.modelId === record.modelId) continue;
          records.set(record.id, record);
          if (delta > 0) {
            days.set(today, (days.get(today) ?? 0) + delta);
            if (lastActiveDay !== today) {
              streakLength = lastActiveDay === previousDay(today) ? streakLength + 1 : 1;
              lastActiveDay = today;
              longestStreak = Math.max(longestStreak, streakLength);
            }
          }
          dirty = true;
        }
        peakDayTokens = Math.max(peakDayTokens, ...days.values());
        const dates = [...days.keys()].sort();
        for (const date of dates.slice(0, Math.max(0, dates.length - MAX_DAYS))) days.delete(date);
        await flush();
      });
    },
    snapshot() {
      return enqueue(async () => {
        await load();
        await flush();
        return {
          lifetimeTokens: [...records.values()].reduce((total, record) => total + record.tokens, 0),
          peakDayTokens,
          sessions: records.size,
          currentStreak:
            lastActiveDay === dayKey(now()) || lastActiveDay === previousDay(dayKey(now()))
              ? streakLength
              : 0,
          longestStreak,
          trackingSince,
          days: [...days]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([date, tokens]) => ({ date, tokens })),
          harnesses: ranking(records, (record) => HARNESS_NAMES[record.provider]),
          models: ranking(records, (record) => record.modelId),
        };
      });
    },
    flush: () => enqueue(flush),
  };
}

module.exports = { createProfileUsage };
