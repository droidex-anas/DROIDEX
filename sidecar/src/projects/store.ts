import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Project } from './types.js';

interface FileState { version: 1; projects: Project[] }

export class ProjectStore {
  private readonly path: string;
  private projects: Project[] = [];

  constructor(dataDir: string) { this.path = join(dataDir, 'projects.json'); }

  async load(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!isState(value)) throw new Error('Invalid Projects state.');
      this.projects = value.projects;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  list(): readonly Project[] { return this.projects; }

  async write(projects: Project[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = this.path + '.tmp';
    await writeFile(tmp, JSON.stringify({ version: 1, projects } satisfies FileState), 'utf8');
    await rename(tmp, this.path);
    this.projects = projects;
  }
}

function isState(value: unknown): value is FileState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1 && Array.isArray(record.projects);
}
