const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createBrowserCredentialVault,
  secureCredentialOrigin,
} = require('./browserCredentialVault.cjs');

function protectedStorage() {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8'),
  };
}

async function withVault(run, options = {}) {
  const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'droidex-browser-vault-'));
  const prompts = [];
  const responses = [...(options.responses || [])];
  const vault = createBrowserCredentialVault({
    appName: 'DROIDEX',
    userDataPath,
    platform: options.platform || 'darwin',
    safeStorage: options.safeStorage || protectedStorage(),
    systemPreferences: options.systemPreferences || {
      canPromptTouchID: () => false,
      promptTouchID: async () => undefined,
    },
    showPrompt:
      options.showPrompt ??
      (async (prompt) => {
        prompts.push(prompt);
        return { response: responses.shift() ?? 1 };
      }),
  });
  try {
    await run({ vault, prompts, userDataPath });
  } finally {
    await fs.rm(userDataPath, { recursive: true, force: true });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test('saved logins require HTTPS except explicit loopback development origins', () => {
  assert.equal(
    secureCredentialOrigin('https://accounts.example.com/login'),
    'https://accounts.example.com',
  );
  assert.equal(secureCredentialOrigin('http://localhost:3000/login'), 'http://localhost:3000');
  assert.throws(() => secureCredentialOrigin('http://example.com/login'), /require HTTPS/);
});

test('credential capture keeps one prompt and revalidates before saving', async () => {
  await withVault(
    async ({ vault, prompts }) => {
      const first = vault.capture({
        url: 'https://example.com/login',
        username: 'user@example.com',
        password: 'secret',
        isStillValid: () => false,
      });
      const overlapping = await vault.capture({
        url: 'https://example.com/login',
        username: 'other@example.com',
        password: 'other-secret',
      });
      assert.equal(overlapping, false);
      assert.equal(await first, false);
      assert.equal(prompts.length, 1);
      assert.equal(prompts[0].defaultId, 1);
      assert.deepEqual(await vault.origins(), []);
    },
    { responses: [0] },
  );
});

test('saved credential use requires an explicit prompt and never returns data after denial', async () => {
  await withVault(
    async ({ vault, prompts }) => {
      assert.equal(
        await vault.capture({
          url: 'https://example.com/login',
          username: 'user@example.com',
          password: 'secret',
        }),
        true,
      );
      await assert.rejects(vault.credentialForAgent('https://example.com/login'), /denied/);
      assert.equal(prompts[1].defaultId, 1);
      assert.deepEqual(await vault.origins(), ['https://example.com']);
    },
    { responses: [0, 1] },
  );
});

test('deleting a saved login while approval is open revokes the pending use', async () => {
  const approval = deferred();
  const usePromptShown = deferred();
  await withVault(
    async ({ vault }) => {
      assert.equal(
        await vault.capture({
          url: 'https://example.com/login',
          username: 'user@example.com',
          password: 'secret',
        }),
        true,
      );
      const pendingUse = vault.credentialForAgent('https://example.com/login');
      await usePromptShown.promise;
      await vault.delete('https://example.com');
      approval.resolve({ response: 0 });

      await assert.rejects(pendingUse, /No saved login/);
    },
    {
      showPrompt: async (prompt) => {
        if (prompt.title.startsWith('Save login')) return { response: 0 };
        usePromptShown.resolve();
        return approval.promise;
      },
    },
  );
});

test('saved login storage fails closed when operating-system encryption is unavailable', async () => {
  await withVault(
    async ({ vault, prompts }) => {
      assert.equal(await vault.isAvailable(), false);
      assert.equal(
        await vault.capture({
          url: 'https://example.com/login',
          username: 'user@example.com',
          password: 'secret',
        }),
        false,
      );
      assert.deepEqual(prompts, []);
    },
    {
      safeStorage: {
        ...protectedStorage(),
        isEncryptionAvailable: () => false,
      },
    },
  );
});

test('a saved login relabelled to another origin fails closed', async () => {
  await withVault(
    async ({ vault, userDataPath }) => {
      assert.equal(
        await vault.capture({
          url: 'https://example.com/login',
          username: 'user@example.com',
          password: 'secret',
        }),
        true,
      );
      const filePath = path.join(userDataPath, 'browser-credentials.enc');
      const rows = JSON.parse(await fs.readFile(filePath, 'utf8'));
      rows[0].origin = 'https://evil.com';
      await fs.writeFile(filePath, JSON.stringify(rows));

      await assert.rejects(
        vault.credentialForAgent('https://evil.com/login'),
        /could not be decrypted/,
      );
    },
    { responses: [0, 0] },
  );
});

test('macOS requires Touch ID after consent and never decrypts after its cancellation', async () => {
  let canceled = true;
  let decryptions = 0;
  let authentications = 0;
  const storage = protectedStorage();
  await withVault(
    async ({ vault }) => {
      await vault.capture({
        url: 'https://example.com/login',
        username: 'account',
        password: 'secret',
      });
      await assert.rejects(vault.credentialForAgent('https://example.com'), /Touch ID.*canceled/);
      assert.equal(decryptions, 0);
      canceled = false;
      assert.deepEqual(await vault.credentialForAgent('https://example.com'), {
        username: 'account',
        password: 'secret',
      });
      assert.equal(authentications, 2);
      assert.equal(decryptions, 1);
    },
    {
      responses: [0, 0, 0],
      safeStorage: {
        ...storage,
        decryptString: (value) => {
          decryptions++;
          return storage.decryptString(value);
        },
      },
      systemPreferences: {
        canPromptTouchID: () => true,
        promptTouchID: async () => {
          authentications++;
          if (canceled) throw new Error('canceled');
        },
      },
    },
  );
});
