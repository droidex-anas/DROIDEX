import test from 'node:test';
import assert from 'node:assert/strict';
import { locateInstall } from './harnessCli.js';

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
  assert.deepEqual(npm.update.args, ['install', '--global', '@anthropic-ai/claude-code@latest']);
  assert.ok(npm.update.env?.PATH?.startsWith('/Users/me/.nvm/versions/node/v22.0.0/bin'));

  const native = locateInstall(
    '/Users/me/.local/bin/claude',
    '/Users/me/.local/share/claude/versions/2.1.280',
  );
  assert.equal(native.source, 'native');
  assert.deepEqual(native.update, { command: '/Users/me/.local/bin/claude', args: ['update'] });
});
