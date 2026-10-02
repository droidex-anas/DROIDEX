import test from 'node:test';
import assert from 'node:assert';
import {
  MAX_TERMINAL_COLS,
  MAX_TERMINAL_ROWS,
  buildPtyEnv,
  defaultShell,
  resolveDimension,
  selectForReplay,
  validateCwd,
} from './terminalConfig';
import type { FsPromisesLike } from './terminalConfig';

interface MockFsOptions {
  real?: string;
  statThrows?: Error;
  realpathThrows?: Error;
  isDir?: boolean;
}

function mockFs(opts: MockFsOptions = {}): FsPromisesLike {
  return {
    stat: async () => {
      if (opts.statThrows) throw opts.statThrows;
      return { isDirectory: () => opts.isDir ?? true };
    },
    realpath: async () => {
      if (opts.realpathThrows) throw opts.realpathThrows;
      return opts.real ?? '/resolved';
    },
  };
}

test('defaultShell prefers $SHELL on POSIX with a login flag', () => {
  assert.deepEqual(defaultShell('darwin', { SHELL: '/bin/fish' }), {
    file: '/bin/fish',
    args: ['-l'],
  });
  assert.deepEqual(defaultShell('linux', {}), { file: '/bin/bash', args: ['-l'] });
  assert.deepEqual(defaultShell('darwin', {}), { file: '/bin/zsh', args: ['-l'] });
});

test('defaultShell uses cmd.exe on Windows unless SHELL points at pwsh', () => {
  assert.deepEqual(defaultShell('win32', { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }), {
    file: 'C:\\Windows\\System32\\cmd.exe',
    args: [],
  });
  assert.deepEqual(defaultShell('win32', { SHELL: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' }), {
    file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    args: ['-NoLogo'],
  });
  // Fall back to cmd.exe when neither COMSPEC nor SHELL is set.
  assert.deepEqual(defaultShell('win32', {}), { file: 'cmd.exe', args: [] });
});

test('buildPtyEnv sets TERM and COLORTERM while preserving other vars', () => {
  const env = buildPtyEnv('darwin', { PATH: '/usr/bin', TERM: 'dumb' });
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.COLORTERM, 'truecolor');
  assert.equal(env.PATH, '/usr/bin');
});

test('validateCwd requires an existing directory and returns its realpath', async () => {
  for (const cwd of ['', undefined, 42]) {
    assert.deepEqual(await validateCwd(cwd, mockFs()), { ok: false, error: 'cwd is required' });
  }
  const failures: Array<[string, FsPromisesLike, RegExp]> = [
    ['/nope', mockFs({ statThrows: new Error('ENOENT') }), /does not exist/],
    ['/a-file', mockFs({ isDir: false }), /not a directory/],
    ['/weird', mockFs({ realpathThrows: new Error('EIO') }), /realpath failed/],
  ];
  for (const [cwd, fs, error] of failures) {
    const result = await validateCwd(cwd, fs);
    assert.equal(result.ok, false, cwd);
    if (!result.ok) assert.match(result.error, error);
  }
  assert.deepEqual(await validateCwd('/tmp/foo', mockFs({ real: '/private/tmp/foo' })), {
    ok: true,
    cwd: '/private/tmp/foo',
  });
});

test('selectForReplay keeps the newest bytes under the cap without splitting code points', () => {
  const bytes = new Uint8Array([0x41, 0x42, 0x43, 0x44, 0x45]); // 'ABCDE'
  // [input, cap, kept data, dropped bytes]
  const cases: Array<[string | Uint8Array, number, string, number]> = [
    ['abc', 10, 'abc', 0],
    ['AAAAAAAAAA', 4, 'AAAA', 6],
    ['hello', 0, '', 5],
    [bytes, 3, 'CDE', 2],
    // The partial emoji at the boundary is dropped with the older bytes.
    ['x🎉y', 3, 'y', 5],
  ];
  for (const [input, cap, data, droppedBytes] of cases) {
    assert.deepEqual(selectForReplay(input, cap), {
      data,
      truncated: droppedBytes > 0,
      droppedBytes,
    });
  }
});

test('resolveDimension falls back for missing / non-finite / non-positive values', () => {
  assert.equal(resolveDimension(undefined, 80), 80);
  assert.equal(resolveDimension(null, 24), 24);
  assert.equal(resolveDimension('not-a-number', 80), 80);
  assert.equal(resolveDimension(NaN, 80), 80);
  assert.equal(resolveDimension(0, 80), 80);
  assert.equal(resolveDimension(-5, 80), 80);
  assert.equal(resolveDimension(132.7, 80), 132);
  assert.equal(resolveDimension('100', 80), 100);
  assert.equal(resolveDimension(Number.MAX_SAFE_INTEGER, 80), MAX_TERMINAL_COLS);
  assert.equal(resolveDimension(Number.MAX_SAFE_INTEGER, 24, MAX_TERMINAL_ROWS), MAX_TERMINAL_ROWS);
});
