import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ClaudeSession } from './claudeSession.js';

// Speak the SDK control protocol without launching an authenticated CLI or a turn.
const fakeCli = String.raw`#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
writeFileSync('launch.json', JSON.stringify(process.argv.slice(2)));
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type !== 'control_request') return;
  appendFileSync('controls.jsonl', JSON.stringify(message.request) + '\n');
  process.stdout.write(JSON.stringify({ type: 'control_response', response: {
    subtype: 'success', request_id: message.request_id, response: { models: [], commands: [] },
  } }) + '\n');
});
`;

for (const fastMode of [undefined, true]) {
  test(`Claude starts fast mode ${String(fastMode ?? false)} and applies live on/off without changing effort`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'claude-fast-mode-'));
    const executable = join(directory, 'fake-cli.mjs');
    writeFileSync(executable, fakeCli);
    chmodSync(executable, 0o755);
    const session = new ClaudeSession({
      appSessionId: randomUUID(),
      executable,
      cwd: directory,
      autonomy: 'low',
      interactionMode: 'auto',
      reasoningEffort: 'ultra',
      fastMode,
      mcpServers: {},
      interactions: {
        requestApproval: () => Promise.reject(new Error('unused')),
        requestQuestion: () => Promise.reject(new Error('unused')),
        cancelPending: () => undefined,
      },
    });
    try {
      await session.start();
      await session.setModel({ fastMode: true });
      await session.setModel({ fastMode: false });
      const args: string[] = JSON.parse(readFileSync(join(directory, 'launch.json'), 'utf8'));
      assert.deepEqual(JSON.parse(args[args.indexOf('--settings') + 1]), {
        ultracode: true,
        fastMode: fastMode ?? false,
      });
      const controls: { subtype: string; settings?: unknown }[] = readFileSync(
        join(directory, 'controls.jsonl'),
        'utf8',
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        controls.filter((request) => request.subtype === 'apply_flag_settings'),
        [
          { subtype: 'apply_flag_settings', settings: { fastMode: true } },
          { subtype: 'apply_flag_settings', settings: { fastMode: false } },
        ],
      );
    } finally {
      await session.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
