import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildHarnessInstallCommand, HarnessCliInstaller, locateInstall } from './harnessCli.js';

test('each harness installs through its documented installers', () => {
  const script = buildHarnessInstallCommand('claude', 'script');
  assert.equal(script.command, 'sh');
  // A failed download must stop before the installer runs.
  assert.match(
    script.args[1] ?? '',
    /curl -fsSL https:\/\/claude\.ai\/install\.sh[^&]*&&[^&]*bash/,
  );
  assert.deepEqual(buildHarnessInstallCommand('claude', 'brew').args, [
    'install',
    '--cask',
    'claude-code',
  ]);
  assert.deepEqual(buildHarnessInstallCommand('codex', 'npm').args, [
    'install',
    '-g',
    '@openai/codex',
  ]);
  assert.throws(() => buildHarnessInstallCommand('codex', 'script'), /no script installer/);
  const devin = buildHarnessInstallCommand('devin', 'script');
  assert.equal(devin.command, 'sh');
  assert.match(
    devin.args[1] ?? '',
    /curl -fsSL https:\/\/cli\.devin\.ai\/install\.sh -o "\$f" && bash "\$f"/,
  );
  assert.deepEqual(buildHarnessInstallCommand('devin', 'brew'), {
    command: 'brew',
    args: ['install', '--cask', 'devin-cli'],
  });
  assert.throws(() => buildHarnessInstallCommand('devin', 'npm'), /no npm installer/);
});

test('locateInstall picks the updater that owns the resolved binary', () => {
  const cask = locateInstall(
    '/opt/homebrew/bin/codex',
    '/opt/homebrew/Caskroom/codex/0.156.1/bin/codex',
  );
  assert.equal(cask.source, 'homebrew');
  assert.deepEqual(cask.update, {
    command: '/opt/homebrew/bin/brew',
    args: ['upgrade', '--cask', 'codex'],
  });

  const formula = locateInstall(
    '/usr/local/bin/claude',
    '/usr/local/Cellar/claude-code/2.1.0/bin/claude',
  );
  assert.deepEqual(formula.update, {
    command: '/usr/local/bin/brew',
    args: ['upgrade', 'claude-code'],
  });

  const npm = locateInstall(
    '/Users/me/.nvm/versions/node/v22.0.0/bin/claude',
    '/Users/me/.nvm/versions/node/v22.0.0/lib/node_modules/@anthropic-ai/claude-code/cli.js',
  );
  assert.equal(npm.source, 'npm');
  assert.deepEqual(npm.update?.args, ['install', '--global', '@anthropic-ai/claude-code@latest']);
  assert.ok(npm.update?.env?.PATH?.startsWith('/Users/me/.nvm/versions/node/v22.0.0/bin'));

  const native = locateInstall(
    '/Users/me/.local/bin/claude',
    '/Users/me/.local/share/claude/versions/2.1.280',
  );
  assert.equal(native.source, 'native');
  assert.deepEqual(native.update, { command: '/Users/me/.local/bin/claude', args: ['update'] });

  const bundled = locateInstall(
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
  );
  assert.equal(bundled.source, 'chatgpt');
  assert.equal(bundled.update, null);
});

test('a Homebrew Devin update runs the owning brew cask updater', async (t) => {
  const prefix = await mkdtemp(join(tmpdir(), 'devin-brew-'));
  const bin = join(prefix, 'bin');
  const cask = join(prefix, 'Caskroom', 'devin-cli', '1.0.0', 'bin');
  const output = join(prefix, 'brew-args.json');
  const keys = ['DEVIN_PATH', 'CLAUDE_PATH', 'CODEX_PATH'] as const;
  const previous = keys.map((key) => process.env[key]);
  t.after(async () => {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    await rm(prefix, { recursive: true, force: true });
  });
  await mkdir(bin);
  await mkdir(cask, { recursive: true });
  await writeFile(join(cask, 'devin'), '#!/bin/sh\necho "devin 1.0.0"\n', { mode: 0o755 });
  await symlink(join(cask, 'devin'), join(bin, 'devin'));
  await writeFile(
    join(bin, 'brew'),
    `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o755 },
  );
  for (const key of keys) process.env[key] = join(bin, 'devin');
  const installer = new HarnessCliInstaller(
    () => undefined,
    () => Promise.resolve(),
  );
  await installer.update('devin');
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), ['upgrade', '--cask', 'devin-cli']);
});
