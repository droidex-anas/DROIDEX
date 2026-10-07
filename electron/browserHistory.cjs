const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJsonFile } = require('./preferenceFile.cjs');

const MAX_ENTRIES = 5_000;
const DAY_MS = 86_400_000;
const SENSITIVE_KEY = /token|code|password|session|auth|key|secret/i;

function historyUrl(value) {
  if (typeof value !== 'string' || value.length > 16_384) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_KEY.test(key)) return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function validEntry(entry) {
  if (!entry || historyUrl(entry.url) !== entry.url || typeof entry.title !== 'string')
    return false;
  const counts = [entry.visitCount, entry.typedCount, entry.userVisitCount, entry.agentVisitCount];
  return (
    entry.title.length <= 1_000 &&
    counts.every((count) => Number.isSafeInteger(count) && count >= 0) &&
    entry.visitCount === entry.userVisitCount + entry.agentVisitCount &&
    Number.isFinite(entry.lastVisitedAt) &&
    entry.lastVisitedAt >= 0
  );
}

function createBrowserHistory({ userData }) {
  const entries = new Map();
  const filePath = () => path.join(userData(), 'browser-history.json');
  let loaded = false;
  let pending = Promise.resolve();

  async function load() {
    if (loaded) return;
    let document;
    try {
      document = JSON.parse(await fs.readFile(filePath(), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        loaded = true;
        return;
      }
      throw new Error(
        'Cannot read browser-history.json. Remove the file from the app profile to reset history.',
      );
    }
    if (
      document?.version !== 1 ||
      !Array.isArray(document.entries) ||
      document.entries.length > MAX_ENTRIES ||
      !document.entries.every(validEntry) ||
      new Set(document.entries.map((entry) => entry.url)).size !== document.entries.length
    ) {
      throw new Error(
        'Invalid browser-history.json. Remove the file from the app profile to reset history.',
      );
    }
    for (const entry of document.entries) entries.set(entry.url, entry);
    loaded = true;
  }

  // Reads and mutations share the queue, so a clear cannot race an earlier visit.
  function run(operation) {
    const result = pending.then(async () => {
      await load();
      return operation();
    });
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function save() {
    await writeJsonFile(fs, filePath(), { version: 1, entries: [...entries.values()] });
  }

  function entryFor(url, now) {
    let entry = entries.get(url);
    if (!entry) {
      entry = {
        url,
        title: '',
        visitCount: 0,
        typedCount: 0,
        userVisitCount: 0,
        agentVisitCount: 0,
        lastVisitedAt: now,
      };
      entries.set(url, entry);
    }
    return entry;
  }

  function trim() {
    if (entries.size <= MAX_ENTRIES) return;
    const oldest = [...entries.values()].sort((a, b) => a.lastVisitedAt - b.lastVisitedAt);
    for (const entry of oldest.slice(0, entries.size - MAX_ENTRIES)) entries.delete(entry.url);
  }

  return {
    recordVisit(value, source) {
      const url = historyUrl(value);
      if (!url) return Promise.resolve();
      if (!['user', 'agent'].includes(source))
        return Promise.reject(new Error('Invalid history visit source.'));
      return run(async () => {
        const now = Date.now();
        const entry = entryFor(url, now);
        entry.visitCount += 1;
        if (source === 'user') entry.userVisitCount += 1;
        else entry.agentVisitCount += 1;
        entry.lastVisitedAt = now;
        trim();
        await save();
      });
    },
    updateTitle(value, title) {
      const url = historyUrl(value);
      if (!url || typeof title !== 'string') return Promise.resolve();
      return run(async () => {
        const entry = entries.get(url);
        const nextTitle = title.slice(0, 1_000);
        if (!entry || entry.title === nextTitle) return;
        entry.title = nextTitle;
        await save();
      });
    },
    recordTyped(value) {
      const url = historyUrl(value);
      if (!url) return Promise.resolve();
      return run(async () => {
        entryFor(url, Date.now()).typedCount += 1;
        trim();
        await save();
      });
    },
    suggest(input, limit = 8) {
      if (
        typeof input !== 'string' ||
        input.length > 16_384 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50
      ) {
        return Promise.reject(
          new Error('History suggestions require text and a limit from 1 to 50.'),
        );
      }
      return run(() => {
        const query = input.trim().toLowerCase();
        const now = Date.now();
        const matches = [];
        for (const entry of entries.values()) {
          if (entry.visitCount === 0) continue;
          const url = new URL(entry.url);
          const address = entry.url.toLowerCase();
          const host = url.host.toLowerCase().replace(/^www\./, '');
          const prefix =
            host.startsWith(query) ||
            address.startsWith(query) ||
            address.replace(/^https?:\/\//, '').startsWith(query);
          const title = entry.title.toLowerCase().includes(query);
          if (!prefix && !title) continue;
          const ageDays = Math.max(0, now - entry.lastVisitedAt) / DAY_MS;
          const score =
            8 * Math.log2(1 + entry.typedCount) +
            3 * Math.log2(1 + entry.userVisitCount) +
            Math.log2(1 + entry.visitCount) +
            10 / (1 + ageDays);
          matches.push({ entry, prefix, score });
        }
        matches.sort(
          (a, b) =>
            Number(b.prefix) - Number(a.prefix) ||
            b.score - a.score ||
            b.entry.lastVisitedAt - a.entry.lastVisitedAt ||
            a.entry.url.localeCompare(b.entry.url),
        );
        return matches.slice(0, limit).map(({ entry }) => ({ ...entry }));
      });
    },
    remove(value) {
      const url = historyUrl(value);
      if (!url) return Promise.resolve();
      return run(async () => {
        if (entries.delete(url)) await save();
      });
    },
    clear() {
      return run(async () => {
        entries.clear();
        await save();
      });
    },
    flush: () => pending,
  };
}

module.exports = { createBrowserHistory };
