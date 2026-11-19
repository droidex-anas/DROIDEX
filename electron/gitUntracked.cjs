const path = require('node:path');
const fsp = require('node:fs/promises');
const { tryRun } = require('./gitCommand.cjs');
const { cachedRead, setRepoCache } = require('./gitRepository.cjs');

const UNTRACKED_FILE_CAP = 1000;
const UNTRACKED_BYTE_CAP = 1024 * 1024;
const UNTRACKED_SCAN_CONCURRENCY = 8;

// Untracked-file content cache keyed by repo root, reused across the 6s poll so
// unchanged files are not re-read every cycle. Each file is keyed by a
// size+mtime signature; any edit invalidates it. The per-root map is rebuilt
// from each scan, so vanished files drop out and growth stays bounded.
const untrackedScanCache = new Map();

// Scan untracked (but not ignored) files once, returning a line-addition count,
// binary flag, and size+mtime signature per file. Per-file results are memoized
// by signature so file contents are not re-read when nothing changed. The whole
// scan is also TTL-cached so the several diff queries of one poll cycle share a
// single ls-files + stat pass.
function scanUntracked(root) {
  return cachedRead(root, 'untracked', () => scanUntrackedOf(root));
}

async function scanUntrackedOf(root) {
  const listing = await tryRun(root, ['ls-files', '--others', '--exclude-standard']);
  const names = String(listing || '')
    .split('\n')
    .filter(Boolean)
    .slice(0, UNTRACKED_FILE_CAP);
  const prior = untrackedScanCache.get(root) || new Map();
  const next = new Map();
  const out = new Array(names.length);

  const scanOne = async (rel) => {
    let entry = { path: rel, additions: 0, binary: false, sig: null };
    const full = path.join(root, rel);
    try {
      // Open first and run every check through the descriptor: the cache
      // probe (fstat), the size check, and the read all observe the same
      // file, so there's no path-based check-then-use window where the entry
      // could be swapped between a probe stat() and the open/read.
      let fh;
      try {
        fh = await fsp.open(full, 'r');
        const stat = await fh.stat();
        const sig = `${stat.size}:${stat.mtimeMs}`;
        const cached = prior.get(rel);
        if (cached && cached.sig === sig) {
          return { path: rel, additions: cached.additions, binary: cached.binary, sig };
        }
        let additions = 0;
        let binary = false;
        if (stat.isFile() && stat.size <= UNTRACKED_BYTE_CAP) {
          const buf = await fh.readFile();
          if (buf.includes(0)) binary = true;
          else {
            const text = buf.toString('utf8');
            additions =
              text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
          }
        } else if (stat.size > UNTRACKED_BYTE_CAP) {
          binary = true;
        }
        entry = { path: rel, additions, binary, sig };
      } finally {
        await fh?.close();
      }
    } catch {
      // ignore unreadable entries
    }
    return entry;
  };

  // Bounded worker pool: a cold scan of hundreds of files would otherwise pay
  // one sequential open/stat/read round-trip each, but unbounded Promise.all
  // could exhaust file descriptors on huge repos.
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(UNTRACKED_SCAN_CONCURRENCY, names.length) },
    async () => {
      while (cursor < names.length) {
        const i = cursor++;
        out[i] = await scanOne(names[i]);
      }
    },
  );
  await Promise.all(workers);

  for (const entry of out) {
    if (entry.sig) {
      next.set(entry.path, { additions: entry.additions, binary: entry.binary, sig: entry.sig });
    }
  }
  setRepoCache(untrackedScanCache, root, next);
  return out;
}

module.exports = { scanUntracked, UNTRACKED_FILE_CAP, UNTRACKED_SCAN_CONCURRENCY };
