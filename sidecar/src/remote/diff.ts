import { constants } from 'node:fs';
import { isPrivateProjectPath } from './workspaceFiles.js';
import { execFile } from 'node:child_process';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { RemoteChange } from './types.js';

const execute = promisify(execFile);
const BYTE_LIMIT = 512 * 1024;
const FILE_LIMIT = 60;
const GIT = ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false'];

export async function readWorkspaceDiff(cwd: string): Promise<{ changes: RemoteChange[]; note: string }> {
  try {
    const options = { cwd, maxBuffer: BYTE_LIMIT, timeout: 5_000, windowsHide: true };
    await execute('git', [...GIT, 'rev-parse', '--show-toplevel'], options);
    let hasHead = true;
    try { await execute('git', [...GIT, 'rev-parse', '--verify', 'HEAD'], options); }
    catch { hasHead = false; }
    const stdout = hasHead ? (await execute('git', [...GIT, 'diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', 'HEAD', '--', '.'], options)).stdout : '';
    const all = parseDiff(stdout);
    const parsed = all.filter((file) => !isPrivateProjectPath(file.path));
    const changes = parsed.slice(0, FILE_LIMIT);
    // An unborn repository's working files are all additions, including edits after staging.
    const { stdout: untracked } = await execute('git', [...GIT, 'ls-files', ...(hasHead ? [] : ['--cached']), '--others', '--exclude-standard', '-z', '--', '.'], options);
    let remaining = BYTE_LIMIT - Buffer.byteLength(stdout);
    let omitted = parsed.length > FILE_LIMIT || all.length !== parsed.length;
    for (const name of new Set(untracked.split('\0').filter(Boolean))) {
      if (isPrivateProjectPath(name)) { omitted = true; continue; }
      if (changes.length >= FILE_LIMIT || remaining <= 0) { omitted = true; break; }
      const candidate = resolve(cwd, name);
      const info = await lstat(candidate).catch(() => undefined);
      if (!info) { omitted = true; continue; }
      if (!info.isFile() || info.isSymbolicLink() || info.size > remaining) { omitted = true; continue; }
      const target = await realpath(candidate);
      const relation = relative(cwd, target);
      if (relation === '..' || relation.startsWith('../') || relation.startsWith('..\\') || isAbsolute(relation)) { omitted = true; continue; }
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      let data: Buffer;
      try {
        // Read a bounded prefix even if a file grows after stat.
        const buffer = Buffer.alloc(remaining + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        data = buffer.subarray(0, bytesRead);
      } finally { await handle.close(); }
      if (data.length > remaining) { omitted = true; continue; }
      remaining -= data.length;
      if (data.includes(0)) { changes.push({ path: name, status: 'added', note: 'Binary file', lines: [] }); continue; }
      const lines = data.toString('utf8').split('\n');
      if (lines.at(-1) === '') lines.pop();
      changes.push({ path: name, status: 'added', lines: lines.map((text, index) => ({ kind: 'addition', text, newLine: index + 1 })) });
    }
    let lineBudget = 8_000;
    for (const change of changes) {
      if (change.lines.length > lineBudget) { change.lines = change.lines.slice(0, lineBudget); change.note = 'Partial diff. Continue on your computer.'; omitted = true; }
      lineBudget -= change.lines.length;
    }
    return { changes, note: 'Working-tree changes, including edits made before this session. Review only; nothing is applied here.'
      + (omitted ? ' Some private paths, large files, or additional changes are omitted.' : '') };
  } catch {
    return { changes: [], note: 'Diff unavailable. Check that the shared project is a Git repository. Large diffs must be reviewed on your computer.' };
  }
}

export function parseDiff(patch: string): RemoteChange[] {
  const changes: RemoteChange[] = [];
  let file: RemoteChange | undefined;
  let oldLine = 0, newLine = 0, inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(line);
      file = { path: match?.[2] || 'Path shown in desktop diff', status: 'modified', lines: [] };
      changes.push(file); inHunk = false; continue;
    }
    if (!file) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]); newLine = Number(hunk[2]); inHunk = true;
      file.lines.push({ kind: 'hunk', text: line }); continue;
    }
    if (inHunk) {
      if (line.startsWith('+')) file.lines.push({ kind: 'addition', text: line.slice(1), newLine: newLine++ });
      else if (line.startsWith('-')) file.lines.push({ kind: 'deletion', text: line.slice(1), oldLine: oldLine++ });
      else if (line.startsWith(' ')) file.lines.push({ kind: 'context', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
      continue;
    }
    if (line.startsWith('+++ b/')) file.path = line.slice(6).split('\t')[0]!;
    else if (line.startsWith('--- a/') && file.status === 'deleted') file.path = line.slice(6).split('\t')[0]!;
    else if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename to ')) { file.path = line.slice(10); file.status = 'renamed'; }
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.note = 'Binary file. Open on your computer.';
    else if (line.startsWith('old mode ') || line.startsWith('new mode ')) file.note = 'File permissions changed.';
  }
  return changes;
}
