import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { RemoteError } from './types.js';

const PAGE_SIZE = 100;
const PREVIEW_BYTES = 64 * 1024;
const OMITTED = new Set(['.git', 'node_modules', '.ds_store', '.ssh', '.aws', '.gnupg']);
function privateName(name: string): boolean {
  return OMITTED.has(name.toLowerCase()) || /^\.env(?:\.|$)/i.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name);
}

export function isPrivateProjectPath(path: string): boolean {
  return path.split(/[\\/]/).some(privateName);
}

async function sharedPath(workspace: string, input: string): Promise<string> {
  if (input.length > 4_096 || input.includes('\\') || input.includes('\0') || isAbsolute(input)) {
    throw new RemoteError(400, 'Choose a relative project path.');
  }
  const parts = input === '' ? [] : input.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || privateName(part))) {
    throw new RemoteError(403, 'This path is not shared with the phone.');
  }
  const root = await realpath(workspace);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new RemoteError(403, 'Symbolic links are not opened remotely.');
  }
  const canonical = await realpath(current);
  const suffix = relative(root, canonical);
  if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith(`..${sep}`)) throw new RemoteError(403, 'This path is outside the shared project.');
  return canonical;
}

export async function listWorkspaceFiles(workspace: string, path = '', cursor = '0') {
  if (!/^(0|[1-9][0-9]{0,5})$/.test(cursor)) throw new RemoteError(400, 'Invalid file page.');
  const directory = await sharedPath(workspace, path);
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((item) => !privateName(item.name) && !item.isSymbolicLink() && (item.isFile() || item.isDirectory()))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const start = Number(cursor);
  const page = entries.slice(start, start + PAGE_SIZE).map((item) => ({
    name: item.name, path: path ? `${path}/${item.name}` : item.name, directory: item.isDirectory(),
  }));
  return { path, entries: page, ...(start + PAGE_SIZE < entries.length ? { nextCursor: String(start + PAGE_SIZE) } : {}) };
}

export async function readWorkspaceFile(workspace: string, path: string) {
  if (!path) throw new RemoteError(400, 'Choose a file.');
  const target = await sharedPath(workspace, path);
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new RemoteError(400, 'Choose a regular text file.');
    const bytes = Buffer.alloc(PREVIEW_BYTES + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const truncated = bytesRead > PREVIEW_BYTES;
    const content = bytes.subarray(0, Math.min(bytesRead, PREVIEW_BYTES));
    if (content.includes(0)) throw new RemoteError(415, 'Binary files are not previewed on mobile.');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(content, { stream: truncated }); }
    catch { throw new RemoteError(415, 'This file is not UTF-8 text. Open it on the desktop.'); }
    return { path, text, truncated };
  } finally { await file.close(); }
}
