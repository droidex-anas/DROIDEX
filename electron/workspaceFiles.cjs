const fsp = require('node:fs/promises');
const path = require('node:path');
const { expandHome } = require('./gitRepository.cjs');

async function listFiles(dir) {
  const root = expandHome(dir);
  const rootStat = await fsp.stat(root);
  if (!rootStat.isDirectory()) throw new Error('not a directory');
  const skip = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'target',
    '.next',
    '.cache',
    'out',
  ]);
  const out = [];
  const stack = [root];
  while (stack.length && out.length < 6000) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !skip.has(entry.name)) stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(path.relative(root, fullPath).split(path.sep).join('/'));
        if (out.length >= 6000) break;
      }
    }
  }
  return out.sort();
}

function readFile(filePath) {
  return fsp.readFile(expandHome(filePath), 'utf8');
}

module.exports = { listFiles, readFile };
