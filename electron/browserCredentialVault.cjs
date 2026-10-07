const fsp = require('node:fs/promises');
const path = require('node:path');

function createBrowserCredentialVault(options) {
  return new BrowserCredentialVault(options);
}

class BrowserCredentialVault {
  constructor(options) {
    this.options = options;
    this.filePath = path.join(options.userDataPath, 'browser-credentials.enc');
    this.writeQueue = Promise.resolve();
    this.promptActive = false;
  }

  async isAvailable() {
    try {
      return (
        this.options.safeStorage.isEncryptionAvailable() &&
        (this.options.platform !== 'linux' ||
          this.options.safeStorage.getSelectedStorageBackend() !== 'basic_text')
      );
    } catch {
      return false;
    }
  }

  touchIdAvailable() {
    if (this.options.platform !== 'darwin') return false;
    try {
      return this.options.systemPreferences?.canPromptTouchID() === true;
    } catch {
      return false;
    }
  }

  async origins() {
    return (await readRows(this.filePath)).map((row) => row.origin).sort();
  }

  async capture({ url, username, password, isStillValid = () => true, signal }) {
    const origin = secureCredentialOrigin(url);
    if (typeof username !== 'string' || username.length > 512) return false;
    if (typeof password !== 'string' || !password || password.length > 4_096) return false;
    if (!(await this.isAvailable()) || this.promptActive) return false;
    this.promptActive = true;
    try {
      const existing = await this.read(origin);
      if (existing?.username === username && existing.password === password) return false;
      const response = await this.options.showPrompt(
        {
          kind: 'credential',
          buttons: ['Save login', 'Not now'],
          defaultId: 1,
          cancelId: 1,
          title: `Save login in ${this.options.appName}?`,
          message: `Save this login for ${origin}?`,
          detail:
            'The login is encrypted with the operating system credential store. DROIDEX does not send it to the agent, but a hostile page that receives it can still leak it.',
        },
        { signal },
      );
      if (response.response !== 0 || signal?.aborted || !isStillValid()) return false;
      return this.upsert(origin, username, password, () => !signal?.aborted && isStillValid());
    } finally {
      this.promptActive = false;
    }
  }

  async credentialForAgent(url, { assertCurrent = () => {}, signal } = {}) {
    const origin = secureCredentialOrigin(url);
    if (!(await this.isAvailable()))
      throw new Error('Protected saved-login storage is unavailable.');
    assertCurrent();
    const row = (await readRows(this.filePath)).find((candidate) => candidate.origin === origin);
    if (!row) throw new Error(`No saved login is available for ${origin}.`);
    assertCurrent();
    const response = await this.options.showPrompt(
      {
        kind: 'credential',
        buttons: ['Use saved login', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Use saved login?',
        message: `Allow DROIDEX to fill your saved login for ${origin}?`,
        detail:
          'DROIDEX fills the login directly into this page without sending it to the agent. A hostile page that receives it can still leak it.',
      },
      { signal },
    );
    assertCurrent();
    if (response.response !== 0) throw new Error(`Saved-login use was denied for ${origin}.`);
    await this.promptTouchId(new URL(origin).hostname);
    assertCurrent();
    const credential = await this.read(origin);
    assertCurrent();
    if (!credential) throw new Error(`No saved login is available for ${origin}.`);
    return credential;
  }

  async delete(origin) {
    origin = validateExactOrigin(origin);
    await this.queueWrite((rows) => rows.filter((row) => row.origin !== origin));
  }

  async upsert(origin, username, password, isStillValid) {
    return this.queueStorageOperation(async () => {
      const encrypted = this.options.safeStorage.encryptString(
        JSON.stringify({ origin, username, password }),
      );
      const rows = await readRows(this.filePath);
      if (!isStillValid()) return false;
      if (rows.length >= 500 && !rows.some((row) => row.origin === origin))
        throw new Error('Saved login storage is full. Delete a login in Settings > Browser first.');
      return writeRows(
        this.filePath,
        [
          ...rows.filter((row) => row.origin !== origin),
          { origin, enc: encrypted.toString('base64') },
        ],
        isStillValid,
      );
    });
  }

  async read(origin) {
    return this.queueStorageOperation(async () => {
      const rows = await readRows(this.filePath);
      const row = rows.find((candidate) => candidate.origin === origin);
      return row ? this.decrypt(origin, row) : undefined;
    });
  }

  decrypt(origin, row) {
    let parsed;
    try {
      const decrypted = this.options.safeStorage.decryptString(Buffer.from(row.enc, 'base64'));
      parsed = JSON.parse(decrypted);
      if (
        parsed?.origin !== origin ||
        typeof parsed.username !== 'string' ||
        typeof parsed.password !== 'string'
      )
        throw new Error();
    } catch {
      throw new Error(
        `The saved login for ${origin} could not be decrypted. Delete it in Settings > Browser and save it again.`,
      );
    }
    return { username: parsed.username, password: parsed.password };
  }

  queueWrite(update) {
    return this.queueStorageOperation(async () => {
      const rows = update(await readRows(this.filePath));
      await writeRows(this.filePath, rows);
    });
  }

  queueStorageOperation(operation) {
    const run = this.writeQueue.then(operation);
    this.writeQueue = run.catch(() => {});
    return run;
  }

  async promptTouchId(hostname) {
    if (!this.touchIdAvailable()) return;
    try {
      await this.options.systemPreferences.promptTouchID(`Use the saved login for ${hostname}`);
    } catch {
      throw new Error('Touch ID confirmation was canceled.');
    }
  }
}

function secureCredentialOrigin(value) {
  const origin = exactHttpOrigin(value);
  const url = new URL(origin);
  if (url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    return origin;
  throw new Error('Saved logins require HTTPS. Plain HTTP is allowed only for local development.');
}

function validateExactOrigin(value) {
  const origin = exactHttpOrigin(value);
  if (origin !== value) throw new Error('Saved login site must be an exact origin.');
  return origin;
}

function exactHttpOrigin(value) {
  if (typeof value !== 'string' || value.length > 8_192 || !URL.canParse(value)) {
    throw new Error('Saved login URL is invalid.');
  }
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    throw new Error('Saved login URLs must use HTTP(S) without embedded credentials.');
  return parsed.origin;
}

async function readRows(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new Error(
      'Saved login storage is invalid. Move browser-credentials.enc aside in the app profile directory, then save your logins again.',
    );
  }
  if (!Array.isArray(parsed) || parsed.length > 500)
    throw new Error(
      'Saved login storage is invalid. Move browser-credentials.enc aside in the app profile directory, then save your logins again.',
    );
  for (const row of parsed) {
    if (
      !row ||
      typeof row !== 'object' ||
      Object.keys(row).some((key) => key !== 'origin' && key !== 'enc') ||
      typeof row.enc !== 'string' ||
      row.enc.length > 32_768
    ) {
      throw new Error(
        'Saved login storage is invalid. Move browser-credentials.enc aside in the app profile directory, then save your logins again.',
      );
    }
    validateExactOrigin(row.origin);
  }
  if (new Set(parsed.map((row) => row.origin)).size !== parsed.length)
    throw new Error(
      'Saved login storage contains duplicate sites. Move browser-credentials.enc aside and save your logins again.',
    );
  return parsed;
}

async function writeRows(filePath, rows, isStillValid = () => true) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, JSON.stringify(rows, null, 2), { mode: 0o600 });
    if (!isStillValid()) return false;
    await fsp.rename(temporaryPath, filePath);
    return true;
  } finally {
    await fsp.rm(temporaryPath, { force: true });
  }
}

module.exports = { createBrowserCredentialVault, secureCredentialOrigin };
