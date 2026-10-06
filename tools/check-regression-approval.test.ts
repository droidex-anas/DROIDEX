import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('./check-regression-approval.mjs', import.meta.url));
const gateContext = 'Held-out regression suite unchanged';
type Status = { context: string; state: string; description: string; creator: { login: string } };

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'regression-approval-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pr = {
    number: 7,
    head: { sha: 'a'.repeat(40) },
    base: { sha: 'b'.repeat(40), ref: 'integration/optimisation' },
    labels: [{ name: 'regression-approved' }],
    changed_files: 1,
  };
  const statuses = new Map<string, Status[]>();
  let permission = 'write';
  const openPullRequests = [pr];
  const files = [{ filename: 'sidecar/regression/contract.test.ts' }];
  let shareHeadOnApproval = false;
  let metadataError = false;
  const server = createServer(async (request, response) => {
    const path = request.url?.split('?')[0];
    const statusSha = /^\/repos\/owner\/repo\/statuses\/([a-f0-9]{40})$/.exec(path ?? '')?.[1];
    const commitSha = /^\/repos\/owner\/repo\/commits\/([a-f0-9]{40})\/statuses$/.exec(
      path ?? '',
    )?.[1];
    let result: unknown;
    if (path === '/repos/owner/repo/pulls') result = openPullRequests;
    else if (path === `/repos/owner/repo/pulls/${pr.number}`) {
      if (metadataError) {
        response.writeHead(500).end('{}');
        return;
      }
      result = pr;
    } else if (path === `/repos/owner/repo/pulls/${pr.number}/files`) {
      result = files;
    } else if (path === '/repos/owner/repo/collaborators/maintainer/permission') {
      result = { permission };
    } else if (request.method === 'POST' && statusSha) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const status: Status = JSON.parse(Buffer.concat(chunks).toString());
      status.creator = { login: 'github-actions[bot]' };
      statuses.set(statusSha, [status, ...(statuses.get(statusSha) ?? [])]);
      if (shareHeadOnApproval && status.context === 'regression-approval') {
        openPullRequests.push({ ...pr, number: pr.number + 1 });
      }
      result = status;
    } else if (commitSha) {
      result = statuses.get(commitSha) ?? [];
    } else {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(result));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture server address.');

  async function run(action: string, senderType = 'User', attempt = '1', eventPr = pr) {
    const eventPath = join(directory, 'event.json');
    await writeFile(
      eventPath,
      JSON.stringify({
        action,
        pull_request: eventPr,
        label: ['labeled', 'unlabeled'].includes(action)
          ? { name: 'regression-approved' }
          : undefined,
        sender: { login: 'maintainer', type: senderType },
      }),
    );
    const code = await new Promise<number>((resolve) => {
      execFile(
        process.execPath,
        [guard],
        {
          env: {
            ...process.env,
            GITHUB_API_URL: `http://127.0.0.1:${address.port}`,
            GITHUB_TOKEN: 'fixture-token',
            GITHUB_REPOSITORY: 'owner/repo',
            GITHUB_SERVER_URL: 'https://github.com',
            GITHUB_RUN_ID: '1',
            GITHUB_RUN_ATTEMPT: attempt,
            GITHUB_EVENT_NAME: 'pull_request_target',
            GITHUB_EVENT_PATH: eventPath,
          },
        },
        (error) => resolve(error ? 1 : 0),
      );
    });
    return {
      code,
      status: statuses.get(pr.head.sha)?.find((status) => status.context === gateContext)?.state,
    };
  }
  return {
    pr,
    run,
    files,
    openPullRequests,
    shareHeadOnApproval: () => {
      shareHeadOnApproval = true;
    },
    failMetadata: () => {
      metadataError = true;
    },
    setPermission: (value: string) => {
      permission = value;
    },
  };
}

test('regression approval stays bound to the reviewed PR head and base', async (t) => {
  const { pr, run, setPermission, files, openPullRequests, shareHeadOnApproval, failMetadata } =
    await fixture(t);
  assert.deepEqual(await run('opened'), { code: 1, status: 'failure' });
  assert.deepEqual(await run('labeled'), { code: 0, status: 'success' });
  assert.deepEqual(await run('synchronize'), { code: 0, status: 'success' });
  pr.changed_files = 3001;
  assert.deepEqual(await run('opened'), { code: 1, status: 'failure' });
  pr.changed_files = 2;
  assert.deepEqual(await run('opened'), { code: 1, status: 'failure' });
  pr.changed_files = 1;

  const staleHead = structuredClone(pr);
  pr.head.sha = 'c'.repeat(40);
  assert.deepEqual(await run('synchronize'), { code: 1, status: 'failure' });
  assert.deepEqual(await run('labeled', 'User', '1', staleHead), { code: 1, status: 'failure' });
  assert.deepEqual(await run('labeled', 'User', '2'), { code: 1, status: 'failure' });
  assert.deepEqual(await run('labeled'), { code: 0, status: 'success' });
  const staleBase = structuredClone(pr);
  pr.base.sha = 'd'.repeat(40);
  assert.deepEqual(await run('edited'), { code: 1, status: 'failure' });
  assert.deepEqual(await run('labeled', 'User', '1', staleBase), { code: 1, status: 'failure' });
  assert.deepEqual(await run('labeled'), { code: 0, status: 'success' });
  assert.deepEqual(await run('edited', 'User', '1', staleBase), { code: 0, status: 'success' });
  staleBase.labels = [];
  assert.deepEqual(await run('unlabeled', 'User', '1', staleBase), { code: 0, status: 'success' });

  pr.labels = [];
  assert.deepEqual(await run('unlabeled'), { code: 1, status: 'failure' });
  pr.labels = [{ name: 'regression-approved' }];
  assert.deepEqual(await run('labeled', 'Bot'), { code: 1, status: 'failure' });
  setPermission('read');
  assert.deepEqual(await run('labeled'), { code: 1, status: 'failure' });
  setPermission('write');
  assert.deepEqual(await run('labeled'), { code: 0, status: 'success' });
  pr.number = 8;
  assert.deepEqual(await run('opened'), { code: 1, status: 'failure' });

  openPullRequests.push({ ...pr, number: 9 });
  assert.deepEqual(await run('labeled'), { code: 1, status: 'failure' });
  files.length = 0;
  pr.changed_files = 0;
  assert.deepEqual(await run('opened'), { code: 1, status: 'failure' });
  openPullRequests.pop();
  assert.deepEqual(await run('opened'), { code: 0, status: 'success' });
  files.push({ filename: 'sidecar/regression/contract.test.ts' });
  pr.changed_files = 1;
  shareHeadOnApproval();
  assert.deepEqual(await run('labeled'), { code: 1, status: 'failure' });
  failMetadata();
  assert.deepEqual(await run('opened'), { code: 1, status: 'failure' });
});
