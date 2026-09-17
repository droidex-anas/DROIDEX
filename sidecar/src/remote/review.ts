import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseDiff, readWorkspaceDiff } from './diff.js';
import { isPrivateProjectPath } from './workspaceFiles.js';
import { RemoteError } from './types.js';

const execute = promisify(execFile);
export type ReviewRunner = (args: string[]) => Promise<string>;

export class RemoteReview {
  private tasks = new Map<string, Promise<unknown>>();
  private readonly run: ReviewRunner;
  constructor(private readonly workspace: string, run?: ReviewRunner) {
    this.run = run || (async (args) => {
      try {
        const result = await execute('gh', args, { cwd: workspace, timeout: 15_000, maxBuffer: 1024 * 1024,
          windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' } });
        return result.stdout;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') throw new RemoteError(503, 'Install GitHub CLI on the computer, then sign in with gh auth login.');
        throw new RemoteError(502, 'GitHub review is unavailable. Check gh auth status and the shared project’s GitHub remote on your computer. Large PRs may exceed the mobile limit.');
      }
    });
  }

  changes() { return this.once('changes', () => readWorkspaceDiff(this.workspace)); }

  pullRequests() {
    return this.once('pull-requests', async () => {
      const output = await this.run(['pr', 'list', '--state', 'open', '--limit', '20', '--json',
        'number,title,state,url,headRefName,baseRefName,isDraft,updatedAt']);
      const result: unknown = JSON.parse(output);
      if (!Array.isArray(result)) throw new RemoteError(502, 'GitHub returned an invalid pull-request list.');
      return result.slice(0, 20).map(validatePullRequest);
    });
  }

  pullRequest(number: number) {
    if (!Number.isSafeInteger(number) || number < 1 || number > 2_147_483_647) throw new RemoteError(400, 'Invalid pull-request number.');
    return this.once(`pr:${number}`, async () => {
      const raw = JSON.parse(await this.run(['pr', 'view', String(number), '--json',
        'number,title,body,state,url,headRefName,baseRefName,isDraft,updatedAt']));
      const pullRequest = validatePullRequest(raw);
      const patch = await this.run(['pr', 'diff', String(number), '--color', 'never']);
      const all = parseDiff(patch);
      const changes = all.filter((file) => !isPrivateProjectPath(file.path)).slice(0, 60);
      let linesLeft = 8_000;
      let partial = all.length > changes.length || (typeof raw.body === 'string' && raw.body.length > 64_000);
      for (const change of changes) {
        if (change.lines.length > linesLeft) { change.lines = change.lines.slice(0, linesLeft); change.note = 'Partial diff'; partial = true; }
        linesLeft -= change.lines.length;
      }
      return { pullRequest, body: typeof raw.body === 'string' ? raw.body.slice(0, 64_000) : '', review: {
        changes, note: 'Pull-request diff from GitHub. Read-only; no checkout, approval, or merge is performed.'
          + (partial ? ' Some description text, private paths, files, or lines are omitted; open GitHub for the complete diff.' : ''),
      } };
    });
  }

  private once<T>(key: string, action: () => Promise<T>): Promise<T> {
    const pending = this.tasks.get(key);
    if (pending) return pending as Promise<T>;
    if (this.tasks.size >= 3) return Promise.reject(new RemoteError(429, 'A review is already loading. Try again in a moment.'));
    const task = action().finally(() => { this.tasks.delete(key); });
    this.tasks.set(key, task);
    return task;
  }
}

function validatePullRequest(value: unknown) {
  if (!value || typeof value !== 'object') throw new RemoteError(502, 'Invalid pull-request response.');
  const row = value as Record<string, unknown>;
  const keys = ['title', 'state', 'url', 'headRefName', 'baseRefName', 'updatedAt'];
  if (!Number.isSafeInteger(row.number) || keys.some((key) => typeof row[key] !== 'string') || typeof row.isDraft !== 'boolean') {
    throw new RemoteError(502, 'Invalid pull-request fields.');
  }
  const url = new URL(row.url as string);
  if (url.protocol !== 'https:' || url.username || url.password) throw new RemoteError(502, 'Invalid GitHub link.');
  return { number: row.number as number, title: row.title as string, state: row.state as string,
    url: url.href, headRefName: row.headRefName as string, baseRefName: row.baseRefName as string,
    isDraft: row.isDraft as boolean, updatedAt: row.updatedAt as string };
}
