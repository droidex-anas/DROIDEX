import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProviderSession } from '../session.js';
import { CodexProvider } from './CodexProvider.js';
import { DESIGN_SESSION_GUIDANCE } from '../../canvas/designSessionGuidance.js';

const CONFIGURED_CODEX = String.raw`#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { createInterface } = require('node:readline');
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  appendFileSync('requests.jsonl', JSON.stringify(message) + '\n');
  let result = {};
  if (message.method === 'initialize') result = { userAgent: 'codex/0.161.0' };
  if (message.method === 'config/read') result = { config: {
    developer_instructions: 'PROJECT_NATIVE_GUIDANCE_MARKER',
    instructions: 'BASE_NATIVE_GUIDANCE_MARKER',
  } };
  if (message.method === 'thread/start' || message.method === 'thread/resume')
    result = { thread: { id: 'thread-one' }, model: 'test-model' };
  if (message.method === 'skills/list') result = { data: [] };
  if (message.method === 'plugin/installed') result = { marketplaces: [] };
  if (message.method === 'app/list') result = { data: [], nextCursor: null };
  process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n');
});
`;

test('Codex provider preserves configured project instructions beside one Design brief on create and resume', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-design-config-'));
  const executable = join(directory, 'configured-codex.cjs');
  writeFileSync(executable, CONFIGURED_CODEX);
  chmodSync(executable, 0o755);
  const previousPath = process.env.CODEX_PATH;
  process.env.CODEX_PATH = executable;
  const sessions: ProviderSession[] = [];
  try {
    const provider = new CodexProvider();
    const input = {
      cwd: directory,
      autonomy: 'low' as const,
      interactionMode: 'auto' as const,
      sessionPurpose: 'design' as const,
      modelId: 'test-model',
      mcpServers: [],
      interactions: {
        requestApproval: () => Promise.reject(new Error('unused')),
        requestQuestion: async () => ({ cancelled: true, answers: [] }),
        isActive: () => true,
        cancelPending: () => undefined,
      },
    };
    const created = await provider.create(input);
    sessions.push(created);
    await created.close();
    const resumed = await provider.resume(created.providerSessionId, {
      ...input,
      appSessionId: created.providerSessionId,
      resumeId: created.resumeId,
    });
    sessions.push(resumed);
    await resumed.close();
    const requests: { method: string; params: Record<string, unknown> }[] = readFileSync(
      join(directory, 'requests.jsonl'),
      'utf8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const opened = requests.filter(
      (request) => request.method === 'thread/start' || request.method === 'thread/resume',
    );
    assert.equal(opened.length, 2);
    for (const request of opened) {
      assert.equal(
        request.params.developerInstructions,
        `PROJECT_NATIVE_GUIDANCE_MARKER\n\n${DESIGN_SESSION_GUIDANCE}`,
      );
      assert.equal('baseInstructions' in request.params, false);
    }
    assert.deepEqual(
      requests
        .filter((request) => request.method === 'config/read')
        .map((request) => request.params),
      [{ cwd: directory }, { cwd: directory }],
    );
    assert.equal(opened[1].params.threadId, created.resumeId);
  } finally {
    await Promise.all(sessions.map((session) => session.close()));
    if (previousPath === undefined) delete process.env.CODEX_PATH;
    else process.env.CODEX_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
