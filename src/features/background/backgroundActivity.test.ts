import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentProcess, TranscriptEvent } from '../../types/bridge';
import { commandTypedByAgent, finishedCommands } from './backgroundActivity';

function event(id: string, fields: Partial<TranscriptEvent>): TranscriptEvent {
  return {
    id,
    appSessionId: 's1',
    sourceSessionId: 's1',
    role: 'primary',
    ts: 0,
    kind: 'text',
    ...fields,
  };
}

function run(id: string, command: string, startedAt: number, result?: Partial<TranscriptEvent>) {
  const call = event(id, {
    kind: 'tool_call',
    toolName: 'Execute',
    toolArgs: { command },
    toolUseId: id,
    ts: startedAt,
  });
  if (!result) return [call];
  return [call, event(`${id}-result`, { kind: 'tool_result', toolUseId: id, ...result })];
}

function process(overrides: Partial<AgentProcess> = {}): AgentProcess {
  return { pid: 1, name: 'vite', command: 'node vite', startedAt: 0, ports: [], ...overrides };
}

test('earlier commands are the finished ones, newest first, with how each ended', () => {
  const transcript = [
    ...run('build', 'npm run build', 1_000, { ts: 4_000 }),
    ...run('lint', 'npm run lint', 5_000, { ts: 6_000, isError: true }),
    ...run('dev', 'npm run dev', 7_000, { ts: 8_000 }),
    ...run('test', 'npm test', 9_000, { ts: 9_500, interrupted: true }),
    ...run('pending', 'sleep 30', 10_000),
    // The first dev server still runs, but this later run of it has ended.
    ...run('rerun', 'npm run dev', 11_000, { ts: 11_200, isError: true }),
  ];
  const stillServing = [process({ originCommand: '/bin/zsh -c npm run dev', startedAt: 7_500 })];

  assert.deepEqual(
    finishedCommands(transcript, stillServing).map(({ id, outcome, durationMs }) => ({
      id,
      outcome,
      durationMs,
    })),
    [
      { id: 'rerun', outcome: 'failed', durationMs: 200 },
      { id: 'test', outcome: 'interrupted', durationMs: 500 },
      { id: 'lint', outcome: 'failed', durationMs: 1_000 },
      { id: 'build', outcome: 'succeeded', durationMs: 3_000 },
    ],
  );
});

test('a process is titled by the command the agent typed into its shell', () => {
  assert.equal(
    commandTypedByAgent(process({ originCommand: '/bin/zsh -lc npm run dev' })),
    'npm run dev',
  );
  assert.equal(
    commandTypedByAgent(process({ originCommand: '/bin/fish --command=npm run dev' })),
    'npm run dev',
  );
  // A shell that exec'd its command leaves only the process to name it.
  assert.equal(commandTypedByAgent(process()), 'vite');
});
