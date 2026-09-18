import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize } from 'node:path';
import type { AutomationStore } from './types.js';

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_STORED_BYTES = 512 * 1024 * 1024;
const OWNED_NAME = /^[0-9a-f-]{36}--[^/]+$/;

/** Only this directory's UUID-prefixed snapshots are owned; sources are never changed. */
export class AutomationAttachments {
  private directory: string | undefined;
  private readonly stored = new Map<string, number>();
  private storedBytes = 0;
  private readonly retained = new Set<readonly string[]>();

  constructor(private readonly dataDir: string) {}

  retain(files: readonly string[]): () => void {
    const reference = [...files];
    this.retained.add(reference);
    return () => {
      this.retained.delete(reference);
    };
  }

  async snapshot(files: readonly string[]): Promise<string[]> {
    if (files.length > 16) throw new Error('Attach at most 16 files.');
    if (files.length === 0) return [];
    const directory = await this.root();
    const paths: string[] = [];
    let bytes = 0;
    for (const path of files) {
      if (!isAbsolute(path) || normalize(path) !== path) {
        throw new Error('Attachment paths must be absolute without traversal.');
      }
      const stat = await lstat(path);
      if (!stat.isFile()) throw new Error('Attachments must be regular files, not symlinks.');
      const parent = await realpath(dirname(path));
      // Electron uses os.tmpdir(), which commonly starts with macOS's /var alias.
      const systemAlias =
        process.platform === 'darwin' &&
        (path.startsWith('/var/') || path.startsWith('/tmp/')) &&
        parent === `/private${dirname(path)}`;
      if (parent !== dirname(path) && !systemAlias)
        throw new Error('Attachment paths must not contain symlink directories.');
      const sourcePath = join(parent, basename(path));
      const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = await source.stat();
        if (!opened.isFile()) throw new Error('Attachments must be regular files.');
        bytes += opened.size;
        if (bytes > MAX_BYTES) throw new Error('Attachments must total at most 100 MiB.');
        if (dirname(sourcePath) === directory && OWNED_NAME.test(basename(sourcePath))) {
          paths.push(sourcePath);
          continue;
        }
        if (this.storedBytes + opened.size > MAX_STORED_BYTES)
          throw new Error('Stored automation attachments must total at most 512 MiB.');
        const destination = join(directory, `${randomUUID()}--${basename(path)}`);
        this.stored.set(destination, opened.size);
        this.storedBytes += opened.size;
        await copySnapshot(source, destination, opened.size);
        const afterCopy = await source.stat();
        if (afterCopy.mtimeMs !== opened.mtimeMs || afterCopy.size !== opened.size) {
          throw new Error('Attachment changed while being saved.');
        }
        paths.push(destination);
      } finally {
        await source.close();
      }
    }
    const rootHandle = await open(directory, 'r');
    try {
      await rootHandle.sync();
    } finally {
      await rootHandle.close();
    }
    return paths;
  }

  async collect(store: AutomationStore): Promise<void> {
    await this.root();
    const referenced = new Set([
      ...store.automations.flatMap((automation) => automation.files),
      ...store.runs.flatMap((run) => run.automation.files),
      ...store.proposals.flatMap((proposal) => proposal.draft.files),
      ...[...this.retained].flatMap((files) => files),
    ]);
    for (const [path, bytes] of this.stored) {
      if (referenced.has(path)) continue;
      try {
        await unlink(path);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          // Startup awaits this sweep, so a file that cannot be removed right
          // now must not fail it. The entry stays tracked and a later sweep
          // retries it. Storage-integrity errors still come from root() above.
          console.error('Could not remove an unreferenced automation attachment', error);
          continue;
        }
      }
      this.stored.delete(path);
      this.storedBytes -= bytes;
    }
  }

  private async root(): Promise<string> {
    if (this.directory) {
      if (!(await lstat(this.directory)).isDirectory()) {
        throw new Error('Automation attachment storage was replaced.');
      }
      return this.directory;
    }
    const path = join(this.dataDir, 'automation-attachments');
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (!(await lstat(path)).isDirectory()) {
      throw new Error('Automation attachment storage must be a directory, not a symlink.');
    }
    const directory = await realpath(path);
    // Discover crash orphans once; this owner tracks subsequent writes without disk walks.
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !OWNED_NAME.test(entry.name)) continue;
      const storedPath = join(directory, entry.name);
      const stat = await lstat(storedPath);
      this.stored.set(storedPath, stat.size);
      this.storedBytes += stat.size;
    }
    this.directory = directory;
    return directory;
  }
}

export function automationExecutionPrompt(prompt: string, files: readonly string[]): string {
  return files.length === 0 ? prompt : `${prompt}\n\n${files.map((path) => `@${path}`).join('\n')}`;
}

async function copySnapshot(
  source: FileHandle,
  destination: string,
  expectedBytes: number,
): Promise<void> {
  const output = await open(destination, 'wx', 0o600);
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let copied = 0;
    while (copied < expectedBytes) {
      const { bytesRead } = await source.read(buffer);
      if (bytesRead === 0) throw new Error('Attachment changed while being saved.');
      copied += bytesRead;
      if (copied > expectedBytes) throw new Error('Attachment changed while being saved.');
      let offset = 0;
      while (offset < bytesRead) {
        const written = await output.write(buffer, offset, bytesRead - offset);
        offset += written.bytesWritten;
      }
    }
    await output.sync();
  } finally {
    await output.close();
  }
}
