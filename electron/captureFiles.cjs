const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MAX_IMAGE_BYTES } = require('./captureValidation.cjs');
const CAPTURE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The host chooses this root. Renderer requests carry identities, never paths.
function createCaptureFiles(root) {
  const location = (name) => {
    if (name !== 'preferences.json' && !/^[0-9a-f-]+(?:\.original\.png|\.json|\.rendered-\d+\.png)$/.test(name)) throw new Error('Invalid capture filename.');
    return path.join(root, name);
  };
  const nameFor = (id, suffix) => {
    if (typeof id !== 'string' || !CAPTURE_ID.test(id)) throw new Error('Invalid capture identity.');
    return `${id}.${suffix}`;
  };
  async function prepare() {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Capture storage is not a private directory.');
    await fs.chmod(root, 0o700);
  }
  async function read(name) {
    const handle = await fs.open(location(name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('Capture file exceeds its limit.');
      return await handle.readFile();
    } finally { await handle.close(); }
  }
  async function write(name, bytes) {
    const file = location(name);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, file);
    } finally { await fs.unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function remove(name) {
    await fs.unlink(location(name)).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  return { prepare, read, write, remove, nameFor,
    async entries() {
      const entries = [];
      for (const name of await fs.readdir(root)) {
        if (!name.endsWith('.tmp')) {
          const stat = await fs.lstat(location(name));
          if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Invalid entry in capture storage.');
          entries.push({ name, size: stat.size });
        }
      }
      return entries;
    },
  };
}
module.exports = { createCaptureFiles };
