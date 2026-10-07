const fs = require('node:fs/promises');
const path = require('node:path');
const { writeJsonFile } = require('./preferenceFile.cjs');
const { redactBrowserDiagnosticUrl } = require('./browserDiagnostics.cjs');

const MAX_ENTRIES = 5_000;
const DAY_MS = 86_400_000;
const WRITE_DELAY_MS = 1_000;

function historyUrl(value) {
  if (typeof value !== 'string' || value.length > 16_384) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const fragment = url.hash.slice(1);
    url.hash = '';
    const fragmentUrl = new URL(url.href);
    fragmentUrl.search = fragment;
    const sensitive =
      redactBrowserDiagnosticUrl(url.href) !== url.href ||
      redactBrowserDiagnosticUrl(fragmentUrl.href) !== fragmentUrl.href;
    if (sensitive) return url.origin + url.pathname;
    return new URL(value).href;
  } catch {
    return null;
  }
}

function validEntry(entry) {
  return (
    entry &&
    historyUrl(entry.url) === entry.url &&
    typeof entry.title === 'string' &&
    entry.title.length <= 1_000 &&
    Number.isSafeInteger(entry.visitCount) &&
    entry.visitCount > 0 &&
    Number.isSafeInteger(entry.typedCount) &&
    entry.typedCount >= 0 &&
    Number.isFinite(entry.lastVisitedAt) &&
    entry.lastVisitedAt >= 0
  );
}

function normalizePrefix(value) {
  return value.toLowerCase().replace(/^(https?:\/\/)?www\./, '$1');
}

function indexEntry(entry) {
  const address = normalizePrefix(entry.url);
  return {
    entry,
    host: normalizePrefix(new URL(entry.url).host),
    address,
    schemelessAddress: address.replace(/^https?:\/\//, ''),
    title: entry.title.toLowerCase(),
  };
}

function compareMatches(a, b) {
  return (
    Number(b.prefix) - Number(a.prefix) ||
    b.score - a.score ||
    b.entry.lastVisitedAt - a.entry.lastVisitedAt ||
    a.entry.url.localeCompare(b.entry.url)
  );
}

function createBrowserHistory({ userData }) {
  let entries = new Map();
  const filePath = () => path.join(userData(), 'browser-history.json');
  let loading;
  let timer;
  let writing;
  let mutations = [];

  function load() {
    if (loading) return loading;
    loading = (async () => {
      let document;
      try {
        document = JSON.parse(await fs.readFile(filePath(), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return;
        throw new Error(
          'Cannot read browser-history.json. Remove the file from the app profile to reset history.',
        );
      }
      if (
        document?.version !== 2 ||
        !Array.isArray(document.entries) ||
        document.entries.length > MAX_ENTRIES ||
        !document.entries.every(validEntry) ||
        new Set(document.entries.map((entry) => entry.url)).size !== document.entries.length
      ) {
        throw new Error(
          'Invalid browser-history.json. Remove the file from the app profile to reset history.',
        );
      }
      entries = new Map(document.entries.map((entry) => [entry.url, indexEntry(entry)]));
    })().catch((error) => {
      loading = undefined;
      throw error;
    });
    return loading;
  }

  function scheduleWrite() {
    if (timer || writing) return;
    timer = setTimeout(() => {
      timer = undefined;
      // Each mutation's caller receives its persistence failure.
      void writePending().catch(() => undefined);
    }, WRITE_DELAY_MS);
  }

  function mutate(apply) {
    const result = new Promise((resolve, reject) => mutations.push({ apply, resolve, reject }));
    scheduleWrite();
    return result;
  }

  function writePending() {
    clearTimeout(timer);
    timer = undefined;
    if (writing) return writing;
    if (mutations.length === 0) return Promise.resolve();
    const batch = mutations;
    mutations = [];
    writing = persist(batch).finally(() => {
      writing = undefined;
      if (mutations.length > 0) scheduleWrite();
    });
    return writing;
  }

  async function persist(batch) {
    try {
      await load();
      const next = new Map(entries);
      for (const mutation of batch) mutation.apply(next);
      if (next.size > MAX_ENTRIES) {
        const oldest = [...next.values()].sort(
          (a, b) => a.entry.lastVisitedAt - b.entry.lastVisitedAt,
        );
        for (const { entry } of oldest.slice(0, next.size - MAX_ENTRIES)) next.delete(entry.url);
      }
      await writeJsonFile(
        fs,
        filePath(),
        { version: 2, entries: [...next.values()].map(({ entry }) => entry) },
        0,
      );
      entries = next;
      for (const mutation of batch) mutation.resolve();
    } catch (error) {
      for (const mutation of batch) mutation.reject(error);
      throw error;
    }
  }

  return {
    recordVisit(value, typed = false) {
      const url = historyUrl(value);
      if (!url) return Promise.resolve();
      const now = Date.now();
      return mutate((next) => {
        const entry = next.get(url)?.entry;
        next.set(
          url,
          indexEntry({
            url,
            title: entry?.title ?? '',
            visitCount: (entry?.visitCount ?? 0) + 1,
            typedCount: (entry?.typedCount ?? 0) + Number(typed),
            lastVisitedAt: now,
          }),
        );
      });
    },
    updateTitle(value, title) {
      const url = historyUrl(value);
      if (!url || typeof title !== 'string') return Promise.resolve();
      return mutate((next) => {
        const entry = next.get(url)?.entry;
        if (entry) next.set(url, indexEntry({ ...entry, title: title.slice(0, 1_000) }));
      });
    },
    async suggest(input, limit = 8) {
      if (
        typeof input !== 'string' ||
        input.length > 16_384 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        throw new Error('History suggestions require text and a limit from 1 to 50.');
      await load();
      const query = normalizePrefix(input.trim());
      const now = Date.now();
      const matches = [];
      for (const row of entries.values()) {
        const { entry } = row;
        const prefix =
          row.host.startsWith(query) ||
          row.address.startsWith(query) ||
          row.schemelessAddress.startsWith(query);
        if (!prefix && !row.title.includes(query)) continue;
        const ageDays = Math.max(0, now - entry.lastVisitedAt) / DAY_MS;
        const score =
          8 * Math.log2(1 + entry.typedCount) +
          4 * Math.log2(1 + entry.visitCount) +
          10 / (1 + ageDays);
        const match = { entry, prefix, score };
        const position = matches.findIndex((other) => compareMatches(match, other) < 0);
        if (position >= 0) matches.splice(position, 0, match);
        else if (matches.length < limit) matches.push(match);
        if (matches.length > limit) matches.pop();
      }
      return matches.map(({ entry }) => ({ ...entry }));
    },
    remove(value) {
      const url = historyUrl(value);
      if (!url) return Promise.resolve();
      return mutate((next) => next.delete(url));
    },
    clear() {
      return mutate((next) => next.clear());
    },
    async flush() {
      while (writing || mutations.length > 0) await writePending();
    },
  };
}

module.exports = { createBrowserHistory };
