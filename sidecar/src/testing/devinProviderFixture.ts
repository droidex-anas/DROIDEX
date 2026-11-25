import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { NormalizedEvent } from '../normalize.js';
import type { PermissionOutcome } from '../protocol.js';
import type { ProviderApprovalRequest, ProviderInteractions } from '../providers/interactions.js';
import { DevinProvider } from '../providers/devin/DevinProvider.js';
import type { DevinSession } from '../providers/devin/devinSession.js';
import { devinAcpCli, writeDevinTestCredentials } from './devinAcpCli.js';

export async function fixture(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), 'devin-provider-'));
  const executable = join(cwd, 'devin.cjs');
  await writeFile(executable, devinAcpCli, { mode: 0o755 });
  const credentials = await writeDevinTestCredentials();
  const previous = process.env.DEVIN_PATH;
  const previousUserData = process.env.DROIDEX_USER_DATA_DIR;
  const sessions: DevinSession[] = [];
  process.env.DEVIN_PATH = executable;
  process.env.DROIDEX_USER_DATA_DIR = cwd;
  t.after(async () => {
    await Promise.all(sessions.map((session) => session.close()));
    if (previous === undefined) delete process.env.DEVIN_PATH;
    else process.env.DEVIN_PATH = previous;
    if (previousUserData === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
    else process.env.DROIDEX_USER_DATA_DIR = previousUserData;
    await rm(cwd, { recursive: true, force: true });
  });
  const approvals: ProviderApprovalRequest[] = [];
  let outcome: PermissionOutcome = 'proceed_once';
  const interactions: ProviderInteractions = {
    requestApproval: (request) => {
      approvals.push(request);
      return Promise.resolve(outcome);
    },
    requestQuestion: () => Promise.resolve({ cancelled: true, answers: [] }),
    isActive: () => true,
    cancelPending: () => undefined,
  };
  const input = {
    cwd,
    appSessionId: 'app-one',
    autonomy: 'low' as const,
    interactionMode: 'auto' as const,
    mcpServers: [],
    interactions,
  };
  const provider = new DevinProvider();
  const create = async () => {
    const session = await provider.create(input);
    sessions.push(session);
    return session;
  };
  const requests = async (): Promise<{ method?: string; params?: Record<string, unknown> }[]> =>
    (await readFile(join(cwd, 'requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
  return {
    cwd,
    credentials,
    input,
    provider,
    create,
    requests,
    approvals,
    sessions,
    answer: (value: PermissionOutcome) => {
      outcome = value;
    },
  };
}

export async function collect(stream: AsyncIterable<NormalizedEvent>): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
