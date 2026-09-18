import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Project } from './types.js';

interface ProjectFile {
  version: 1;
  projects: Project[];
}

export class ProjectStore {
  private readonly path: string;
  private projects: Project[] = [];

  constructor(dataDir: string) {
    this.path = join(dataDir, 'projects.json');
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as ProjectFile;
      this.projects = parsed.version === 1 && Array.isArray(parsed.projects) ? parsed.projects : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  list(): Project[] {
    return this.projects;
  }

  async replace(projects: Project[]): Promise<void> {
    this.projects = projects;
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, projects } satisfies ProjectFile), 'utf8');
    await rename(tmp, this.path);
  }
}
