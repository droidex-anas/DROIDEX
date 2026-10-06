const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  available,
  authenticate,
  cancelSetup,
  install,
  isGithubDeviceUrl,
  listPrs,
  mergePr,
  normalizePr,
  prDiff,
  prSelector,
  resolveBrewExecutable,
  resolveGhExecutable,
  viewPr,
} = require('./github.cjs');
const { runSetupFile } = require('./githubSetup.cjs');

const ghResult = (overrides = {}) => ({
  code: 0,
  stdout: '',
  stderr: '',
  spawnFailed: false,
  ...overrides,
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    if (child.killed) return true;
    child.killed = true;
    queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };
  return child;
}

// A child that ignores SIGTERM and closes only on SIGKILL.
function stubbornChild() {
  const child = fakeChild();
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal ?? 'SIGTERM');
    if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
    return true;
  };
  return child;
}

// gh writes these lines to stderr and exits successfully.
function ghThatPrints(child, ...lines) {
  return () => {
    queueMicrotask(() => {
      for (const line of lines) child.stderr.write(line);
      child.emit('close', 0, null);
    });
    return child;
  };
}

// A verification step that the test finishes by hand once it has started.
function heldStep() {
  let markStarted;
  let finish;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const run = () => {
    markStarted();
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  return { started, run, finish: (value) => finish(value) };
}

// Timers the test fires by hand: timers[0] is the deadline, timers[1] the SIGKILL grace.
function manualTimers() {
  const timers = [];
  return {
    timers,
    setTimer: (callback, timeoutMs) => {
      const timer = { callback, timeoutMs, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: () => undefined,
  };
}

test('resolves gh from PATH first, then from Homebrew under a Finder-style PATH', async () => {
  const resolveFrom = async (PATH, installed) => {
    const accessed = [];
    const versionProbes = [];
    const executable = await resolveGhExecutable({
      env: { PATH, SHELL: '/bin/zsh' },
      access: async (candidate) => {
        accessed.push(candidate);
        if (candidate !== installed) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      runFile: async (file, args) => {
        versionProbes.push([file, args]);
        return ghResult({ stdout: 'gh version 2.78.0' });
      },
    });
    return { executable, accessed, versionProbes };
  };

  const fromPath = await resolveFrom('/custom/bin:/usr/bin', '/custom/bin/gh');
  assert.equal(fromPath.executable, '/custom/bin/gh');
  assert.deepEqual(fromPath.accessed, ['/custom/bin/gh']);

  const fromHomebrew = await resolveFrom('/usr/bin:/bin:/usr/sbin:/sbin', '/opt/homebrew/bin/gh');
  assert.equal(fromHomebrew.executable, '/opt/homebrew/bin/gh');
  assert.deepEqual(fromHomebrew.versionProbes, [['/opt/homebrew/bin/gh', ['--version']]]);
});

test('uses the fixed login-shell lookup last and returns null when it is invalid', async () => {
  const shellCalls = [];
  const executable = await resolveGhExecutable({
    env: { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' },
    access: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    runFile: async (file, args) => {
      shellCalls.push([file, args]);
      return ghResult({ stdout: '/custom/login/bin/gh\n' });
    },
  });

  assert.equal(executable, null);
  assert.deepEqual(shellCalls, [['/bin/zsh', ['-lc', 'command -v gh']]]);
});

test('discovers gh through the macOS login shell when Finder omits SHELL, ignoring banners', async () => {
  const executable = await resolveGhExecutable({
    platform: 'darwin',
    env: { PATH: '/usr/bin:/bin' },
    access: async (candidate) => {
      if (candidate !== '/custom/login/bin/gh') throw new Error('missing');
    },
    runFile: async (file, args) => {
      if (file === '/bin/zsh') {
        assert.deepEqual(args, ['-lc', 'command -v gh']);
        return ghResult({ stdout: 'Welcome to this shell\n/custom/login/bin/gh\n' });
      }
      return ghResult({ stdout: 'gh version 2.78.0' });
    },
  });

  assert.equal(executable, '/custom/login/bin/gh');
});

test('availability reports the supported recovery path when gh is missing', async () => {
  for (const [brew, installMethod] of [
    ['/opt/homebrew/bin/brew', 'homebrew'],
    [null, 'manual'],
  ]) {
    const status = await available({
      runGh: async () => ghResult({ code: 1, spawnFailed: true }),
      resolveBrew: async () => brew,
    });
    assert.deepEqual(status, { installed: false, authenticated: false, installMethod });
  }
});

test('resolves Apple Silicon Homebrew first and Intel Homebrew when it is absent', async () => {
  const resolveWith = (installed) =>
    resolveBrewExecutable({
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', SHELL: '/bin/zsh' },
      access: async (candidate) => {
        if (!installed.includes(candidate)) throw new Error('missing');
      },
      runFile: async (file, args) => {
        assert.equal(file, installed[0]);
        assert.deepEqual(args, ['--version']);
        return ghResult({ stdout: 'Homebrew 4.6.0' });
      },
    });

  assert.equal(
    await resolveWith(['/opt/homebrew/bin/brew', '/usr/local/bin/brew']),
    '/opt/homebrew/bin/brew',
  );
  assert.equal(await resolveWith(['/usr/local/bin/brew']), '/usr/local/bin/brew');
});

test('installs gh with a fixed Homebrew argument vector and verifies gh', async () => {
  const calls = [];
  const result = await install({
    resolveBrew: async () => '/opt/homebrew/bin/brew',
    execute: async (file, args) => {
      calls.push([file, args]);
      return { code: 0, timedOut: false };
    },
    resolveGh: async () => '/opt/homebrew/bin/gh',
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [['/opt/homebrew/bin/brew', ['install', 'gh']]]);
});

test('cancelling during Homebrew discovery never starts installation', async () => {
  const discovery = heldStep();
  let installationStarted = false;
  const pending = install({
    resolveBrew: discovery.run,
    execute: async () => {
      installationStarted = true;
      return { code: 0, timedOut: false };
    },
  });
  await discovery.started;

  cancelSetup();
  discovery.finish('/opt/homebrew/bin/brew');

  assert.deepEqual(await pending, {
    ok: false,
    reason: 'cancelled',
    message: 'GitHub CLI installation was cancelled.',
  });
  assert.equal(installationStarted, false);
});

test('installation verifies gh even when Homebrew exits successfully', async () => {
  const result = await install({
    resolveBrew: async () => '/opt/homebrew/bin/brew',
    execute: async () => ({ code: 0, timedOut: false }),
    resolveGh: async () => null,
  });

  assert.deepEqual(result, {
    ok: false,
    reason: 'verification_failed',
    message: 'GitHub CLI was not found after installation.',
  });
});

test('cancelling during post-install verification cannot report success', async () => {
  const verification = heldStep();
  const pending = install({
    resolveBrew: async () => '/opt/homebrew/bin/brew',
    execute: async () => ({ code: 0, timedOut: false }),
    resolveGh: verification.run,
  });
  await verification.started;

  cancelSetup();
  verification.finish('/opt/homebrew/bin/gh');

  assert.deepEqual(await pending, {
    ok: false,
    reason: 'cancelled',
    message: 'GitHub CLI installation was cancelled.',
  });
});

test('installation reports a missing Homebrew, its failure, and its timeout without raw output', async () => {
  assert.deepEqual(await install({ resolveBrew: async () => null }), {
    ok: false,
    reason: 'installer_missing',
    message: 'Homebrew is not installed.',
  });

  const failed = await install({
    resolveBrew: async () => '/opt/homebrew/bin/brew',
    execute: async () => ({ code: 1, timedOut: false, stderr: 'private package details' }),
  });
  assert.deepEqual(failed, {
    ok: false,
    reason: 'install_failed',
    message: 'Homebrew could not install GitHub CLI.',
  });

  const timedOut = await install({
    resolveBrew: async () => '/opt/homebrew/bin/brew',
    execute: async () => ({ code: 1, timedOut: true }),
  });
  assert.deepEqual(timedOut, {
    ok: false,
    reason: 'timeout',
    message: 'GitHub CLI installation timed out.',
  });
});

test('timed-out installation stays active until the child exits and escalates termination', async () => {
  const child = new EventEmitter();
  const killSignals = [];
  child.kill = (signal) => {
    killSignals.push(signal ?? 'SIGTERM');
    return true;
  };
  const { timers, ...timerOptions } = manualTimers();
  const operation = { child: null };
  let settled = false;

  const pending = runSetupFile('/opt/homebrew/bin/brew', ['install', 'gh'], {
    timeout: 100,
    terminationGraceMs: 25,
    operation,
    spawnProcess: () => child,
    ...timerOptions,
  }).then((result) => {
    settled = true;
    return result;
  });

  assert.equal(operation.child, child);
  assert.equal(timers[0].timeoutMs, 100);
  timers[0].callback();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(operation.child, child);
  assert.deepEqual(killSignals, ['SIGTERM']);

  assert.equal(timers[1].timeoutMs, 25);
  timers[1].callback();
  assert.deepEqual(killSignals, ['SIGTERM', 'SIGKILL']);
  child.emit('close', null, 'SIGKILL');

  assert.deepEqual(await pending, { code: 1, timedOut: true });
  assert.equal(operation.child, null);
});

test('cancelling installation escalates when Homebrew ignores SIGTERM', async () => {
  const child = stubbornChild();
  const { timers, ...timerOptions } = manualTimers();
  const pending = install({
    resolveBrew: async () => '/opt/homebrew/bin/brew',
    execute: (file, args, options) =>
      runSetupFile(file, args, {
        ...options,
        terminationGraceMs: 25,
        spawnProcess: () => child,
        ...timerOptions,
      }),
    resolveGh: async () => '/opt/homebrew/bin/gh',
  });
  await Promise.resolve();

  cancelSetup();
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.equal(timers[1].timeoutMs, 25);
  timers[1].callback();

  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(await pending, {
    ok: false,
    reason: 'cancelled',
    message: 'GitHub CLI installation was cancelled.',
  });
});

test('only one GitHub setup operation runs at a time', async () => {
  const installation = heldStep();
  const first = install({
    resolveBrew: async () => '/opt/homebrew/bin/brew',
    execute: installation.run,
    resolveGh: async () => '/opt/homebrew/bin/gh',
  });
  await installation.started;

  const second = await install({ resolveBrew: async () => '/opt/homebrew/bin/brew' });
  assert.deepEqual(second, {
    ok: false,
    reason: 'busy',
    message: 'GitHub setup is already running.',
  });

  installation.finish({ code: 0, timedOut: false });
  assert.deepEqual(await first, { ok: true });
});

test('accepts only the exact GitHub device-login URL', () => {
  assert.equal(isGithubDeviceUrl('https://github.com/login/device'), true);
  assert.equal(isGithubDeviceUrl('https://github.com/login/device/extra'), false);
  assert.equal(isGithubDeviceUrl('https://github.com.evil.test/login/device'), false);
  assert.equal(isGithubDeviceUrl('http://github.com/login/device'), false);
  assert.equal(isGithubDeviceUrl('not a URL'), false);
});

test('browser authentication lets gh open its device URL and exposes only well-formed codes', async () => {
  const command =
    'auth login --hostname github.com --git-protocol https --web --clipboard --skip-ssh-key';
  for (const [codeLine, expectedCodes] of [
    ['First copy your one-time code: ABCD-7HJK\n', ['ABCD-7HJK']],
    ['First copy your one-time code: not-a-code\n', []],
  ]) {
    const deviceCodes = [];
    // The URL arrives split across two writes, as a pipe may deliver it.
    const printDeviceLogin = ghThatPrints(
      fakeChild(),
      codeLine,
      'Open this URL to continue: https://github.com/login/',
      'device\n',
    );
    const result = await authenticate({
      resolveGh: async () => '/opt/homebrew/bin/gh',
      spawnProcess: (file, args, options) => {
        assert.equal(file, '/opt/homebrew/bin/gh');
        assert.deepEqual(args, command.split(' '));
        assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
        return printDeviceLogin();
      },
      onDeviceCode: (code) => deviceCodes.push(code),
      verifyAuth: async () => true,
    });

    assert.deepEqual(result, { ok: true }, codeLine);
    assert.deepEqual(deviceCodes, expectedCodes, codeLine);
  }
});

test('browser URL rejection stays owned until bounded termination closes the child', async () => {
  const child = stubbornChild();
  const { timers, ...timerOptions } = manualTimers();
  let settled = false;
  const pending = authenticate({
    resolveGh: async () => '/opt/homebrew/bin/gh',
    spawnProcess: () => child,
    verifyAuth: async () => true,
    authTimeoutMs: 1_000,
    terminationGraceMs: 25,
    ...timerOptions,
  }).then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();

  child.stderr.write('Open this URL: https://github.com.evil.test/login/device\n');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(settled, false);
  assert.deepEqual(child.signals, ['SIGTERM']);
  assert.equal(timers[1].timeoutMs, 25);
  timers[1].callback();

  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  assert.deepEqual(await pending, {
    ok: false,
    reason: 'browser_failed',
    message: 'GitHub CLI did not provide a trusted sign-in page.',
  });
});

test('browser authentication requires final gh auth verification and releases the setup lock', async () => {
  for (const verifyAuth of [
    async () => false,
    async () => {
      throw new Error('verification failed');
    },
  ]) {
    const child = fakeChild();
    const result = await authenticate({
      resolveGh: async () => '/opt/homebrew/bin/gh',
      spawnProcess: ghThatPrints(child, 'https://github.com/login/device\n'),
      verifyAuth,
    });

    assert.deepEqual(result, {
      ok: false,
      reason: 'auth_failed',
      message: 'GitHub CLI could not verify the signed-in account.',
    });
  }
  assert.notEqual((await authenticate({ resolveGh: async () => null })).reason, 'busy');
});

test('a timed-out or cancelled browser authentication escalates when its child ignores SIGTERM', async () => {
  const outcomes = [
    ['timeout', (timers) => timers[0].callback(), 'GitHub sign-in timed out.'],
    ['cancelled', () => cancelSetup(), 'GitHub sign-in was cancelled.'],
  ];
  for (const [reason, interrupt, message] of outcomes) {
    const child = stubbornChild();
    const { timers, ...timerOptions } = manualTimers();
    const pending = authenticate({
      resolveGh: async () => '/opt/homebrew/bin/gh',
      spawnProcess: () => child,
      verifyAuth: async () => true,
      authTimeoutMs: 100,
      terminationGraceMs: 25,
      ...timerOptions,
    });
    await Promise.resolve();

    assert.equal(timers[0].timeoutMs, 100, reason);
    interrupt(timers);
    await Promise.resolve();
    assert.deepEqual(child.signals, ['SIGTERM'], reason);

    assert.equal(timers[1].timeoutMs, 25, reason);
    timers[1].callback();
    assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'], reason);
    assert.deepEqual(await pending, { ok: false, reason, message });
  }
});

test('cancelling during final authentication verification cannot report success', async () => {
  const child = fakeChild();
  const verification = heldStep();
  const pending = authenticate({
    resolveGh: async () => '/opt/homebrew/bin/gh',
    spawnProcess: ghThatPrints(child, 'https://github.com/login/device\n'),
    verifyAuth: verification.run,
  });

  await verification.started;
  cancelSetup();
  verification.finish(true);

  assert.deepEqual(await pending, {
    ok: false,
    reason: 'cancelled',
    message: 'GitHub sign-in was cancelled.',
  });
});

test('authentication cannot report success when its deadline expires during verification', async () => {
  const child = fakeChild();
  child.killed = true;
  let timeoutCallback;
  const verification = heldStep();
  const pending = authenticate({
    resolveGh: async () => '/opt/homebrew/bin/gh',
    spawnProcess: ghThatPrints(child, 'https://github.com/login/device\n'),
    verifyAuth: verification.run,
    setTimer: (callback) => {
      timeoutCallback = callback;
      return { unref() {} };
    },
    clearTimer: () => undefined,
  });

  await verification.started;
  timeoutCallback();
  verification.finish(true);

  assert.deepEqual(await pending, {
    ok: false,
    reason: 'timeout',
    message: 'GitHub sign-in timed out.',
  });
});

test('PR selectors accept only bare non-negative digit strings', () => {
  assert.equal(prSelector(78), '78');
  assert.equal(prSelector('078'), '078');
  assert.equal(prSelector(0), '0');
  for (const value of [
    null,
    undefined,
    '',
    '-1',
    '--repo=other/repo',
    '12abc',
    '1.5',
    'feature/foo',
    'https://github.com/example/repo/pull/78',
    ' 12',
    '12 ',
  ]) {
    assert.equal(prSelector(value), null, String(value));
  }
});

test('listPrs returns normalized rows and the viewer login', async () => {
  const runGh = async (_cwd, args) => {
    runGh.calls.push(args);
    if (args[0] === 'api') return ghResult({ stdout: 'octocat\n' });
    return ghResult({
      stdout: JSON.stringify([
        {
          number: 12,
          title: 'Add inbox',
          state: 'OPEN',
          url: 'https://example.test/pull/12',
          isDraft: false,
          headRefName: 'feat',
          baseRefName: 'main',
          mergeable: 'MERGEABLE',
          reviewDecision: 'REVIEW_REQUIRED',
          additions: 4,
          deletions: 1,
          changedFiles: 2,
          createdAt: '2026-08-18T00:00:00Z',
          updatedAt: '2026-08-18T01:00:00Z',
          author: { login: 'ana' },
          reviewRequests: [{ login: 'octocat' }],
          reviews: [{ author: { login: 'dev' }, state: 'COMMENTED' }],
        },
      ]),
    });
  };
  runGh.calls = [];
  const result = await listPrs('/repo', { state: 'open', limit: 50 }, runGh);
  assert.equal(result.ok, true);
  assert.equal(result.viewerLogin, 'octocat');
  assert.equal(result.prs[0].number, 12);
  assert.deepEqual(result.prs[0].reviewRequests, ['octocat']);
  assert.deepEqual(result.prs[0].reviews, [{ author: 'dev', state: 'commented' }]);
  assert.ok(runGh.calls[0].includes('--json'));
});

test('listPrs failures keep no invented rows and name an unresolved repository', async () => {
  const failed = await listPrs('/repo', {}, async (_cwd, args) =>
    args[0] === 'api' ? ghResult({ stdout: 'octocat\n' }) : ghResult({ code: 1, stderr: 'boom' }),
  );
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.prs, []);
  assert.equal(failed.viewerLogin, null);

  const unresolved = await listPrs('/clinic', {}, async () =>
    ghResult({
      code: 1,
      stderr:
        "GraphQL: Could not resolve to a Repository with the name 'evilfps/dr-koshley-skin-clinic'. (repository)",
    }),
  );
  assert.equal(unresolved.ok, false);
  assert.equal(unresolved.reason, 'unresolved_repository');
  assert.equal(unresolved.message, 'GitHub could not find evilfps/dr-koshley-skin-clinic.');
  assert.deepEqual(unresolved.prs, []);
});

test('viewPr rejects a non-integer selector before spawning gh', async () => {
  let spawned = false;
  const runGh = async () => {
    spawned = true;
    return ghResult();
  };
  const result = await viewPr('/repo', { prNumber: 'https://github.com/o/r/pull/1' }, runGh);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_pr');
  assert.equal(result.pr, null);
  assert.equal(spawned, false);
});

test('viewPr returns the body and head branch commits with their GitHub authors', async () => {
  const runGh = async (_cwd, args) => {
    assert.match(args[3], /,commits$/);
    return ghResult({
      stdout: JSON.stringify({
        number: 12,
        title: 'Add inbox',
        state: 'OPEN',
        body: 'Hello',
        author: { login: 'ana' },
        reviewRequests: [],
        reviews: [],
        commits: [
          {
            oid: '1111111111111111',
            messageHeadline: ' Add the inbox ',
            committedDate: '2026-08-04T09:00:00Z',
            authors: [{ name: 'Ana', login: 'ana' }],
          },
          {
            oid: '2222222222222222',
            messageHeadline: 'Vendor bump',
            committedDate: '2026-08-04T10:00:00Z',
            authors: [{ name: 'Release Bot', login: '' }],
          },
          { messageHeadline: 'no oid, dropped' },
        ],
      }),
    });
  };
  const result = await viewPr('/repo', { prNumber: 12 }, runGh);
  assert.equal(result.ok, true);
  assert.equal(result.pr.body, 'Hello');
  assert.deepEqual(result.pr.reviewRequests, []);
  assert.deepEqual(result.pr.commits, [
    {
      oid: '1111111111111111',
      headline: 'Add the inbox',
      committedDate: '2026-08-04T09:00:00Z',
      author: 'ana',
    },
    {
      oid: '2222222222222222',
      headline: 'Vendor bump',
      committedDate: '2026-08-04T10:00:00Z',
      author: 'Release Bot',
    },
  ]);
});

test('mergePr requires a known own strategy and a bare PR number before spawning gh', async () => {
  let spawned = false;
  const runGh = async () => {
    spawned = true;
    return ghResult();
  };
  const badSelector = await mergePr('/repo', { prNumber: '--repo=evil', method: 'squash' }, runGh);
  assert.deepEqual(badSelector, { ok: false, reason: 'missing_pr' });
  // Inherited Object.prototype names must not resolve to a merge flag.
  const badMethods = [
    'fast-forward',
    undefined,
    'toString',
    'constructor',
    'hasOwnProperty',
    '__proto__',
  ];
  for (const method of badMethods) {
    assert.deepEqual(
      await mergePr('/repo', { prNumber: 12, method }, runGh),
      { ok: false, reason: 'invalid_method' },
      String(method),
    );
  }
  assert.equal(spawned, false);
});

test('mergePr passes the chosen strategy to gh and reports its refusal', async () => {
  const calls = [];
  const ok = await mergePr('/repo', { prNumber: 12, method: 'squash' }, async (_cwd, args) => {
    calls.push(args);
    return ghResult();
  });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(calls[0], ['pr', 'merge', '--squash', '--', '12']);

  const refused = await mergePr('/repo', { prNumber: 12, method: 'rebase' }, async () =>
    ghResult({ code: 1, stderr: 'Pull request is not mergeable\n' }),
  );
  assert.deepEqual(refused, {
    ok: false,
    reason: 'gh_error',
    message: 'Pull request is not mergeable',
  });

  const missingGh = await mergePr('/repo', { prNumber: 12, method: 'merge' }, async () =>
    ghResult({ code: 1, spawnFailed: true }),
  );
  assert.deepEqual(missingGh, { ok: false, reason: 'gh_unavailable' });
});

test('prDiff rejects a non-integer selector and returns patch text on success', async () => {
  const bad = await prDiff('/repo', { prNumber: '--repo=evil' }, async () => ghResult());
  assert.equal(bad.ok, false);
  assert.equal(bad.diff, '');
  const good = await prDiff('/repo', { prNumber: 12 }, async (_cwd, args) => {
    assert.deepEqual(args.slice(-2), ['--', '12']);
    return ghResult({ stdout: 'diff --git a/a.ts b/a.ts\n' });
  });
  assert.equal(good.ok, true);
  assert.match(good.diff, /diff --git/);
});

test('normalizePr keeps a queued re-run pending and never merges two checks into one key', () => {
  const stillQueued = normalizePr({
    number: 1,
    statusCheckRollup: [
      { workflowName: 'CI', name: 'build', status: 'QUEUED' },
      { workflowName: 'CI', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
  });
  assert.equal(stillQueued.checks, 'pending');

  // 'Build/Test' + 'lint' and 'Build' + 'Test/lint' are different checks.
  const bothCounted = normalizePr({
    number: 2,
    statusCheckRollup: [
      // The failure is listed first on purpose: a key that merges the two lets
      // the later success bury it, so this reads 'pass' on a colliding key.
      { workflowName: 'Build', name: 'Test/lint', status: 'COMPLETED', conclusion: 'FAILURE' },
      { workflowName: 'Build/Test', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
  });
  assert.equal(bothCounted.checks, 'fail');
});
