// A kit made from the files of a session's project folder (design system
// documents spec §12). DROIDEX reads each named file itself, under rules that
// keep every read inside the folder, so the provenance names only files it
// parsed. The folder comes from the session, never from the agent. A
// shadcn/ui library's components.json names every file its kit reads
// (designSystemLibrary.ts).

import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  importDesignSystem,
  type ImportDesignSystemResult,
  type ImportSource,
} from './designSystemImport.js';
import { importLibraryDesignSystem } from './designSystemLibrary.js';
import { MAX_PROJECT_FILES } from './designSystemProvenance.js';
import { isFileSystemError, projectRelativePath, readProjectText } from './projectPaths.js';

export interface ProjectSource {
  /** Relative to the project folder. */
  path: string;
  kind: ImportSource['kind'] | 'shadcn';
}

type FileSource = ProjectSource & { kind: ImportSource['kind'] };
type ProjectFile = ImportSource & { file: string };
type ProjectRead =
  | { status: 'read'; sources: ProjectFile[] }
  | { status: 'refused'; message: string };

/** A version-1 kit from the named project files, or why it cannot be made. */
export async function importProjectDesignSystem(
  projectRoot: string,
  sources: readonly ProjectSource[],
  kit: { id: string; name: string },
): Promise<ImportDesignSystemResult> {
  const library = sources.find((source) => source.kind === 'shadcn');
  if (library !== undefined && sources.length === 1)
    return importLibraryDesignSystem(projectRoot, library.path, kit);
  const read =
    library === undefined
      ? await readProjectSources(projectRoot, sources.filter(isFileSource))
      : refused('Name components.json alone: it names every file a shadcn/ui kit reads.');
  if (read.status === 'refused')
    return { status: 'refused', diagnostics: [{ code: 'invalid_input', message: read.message }] };
  const files = read.sources.map((source) => source.file);
  return importDesignSystem(read.sources, {
    ...kit,
    provenance: { project: { name: path.basename(projectRoot), files } },
  });
}

function isFileSource(source: ProjectSource): source is FileSource {
  return source.kind !== 'shadcn';
}

async function readProjectSources(
  projectRoot: string,
  sources: readonly FileSource[],
): Promise<ProjectRead> {
  if (sources.length === 0) return refused('Name at least one project file to read.');
  if (sources.length > MAX_PROJECT_FILES)
    return refused(`A kit reads at most ${String(MAX_PROJECT_FILES)} project files.`);
  let root: string;
  try {
    root = await realpath(projectRoot);
  } catch (error) {
    if (!isFileSystemError(error)) throw error;
    return refused('The project folder cannot be read.');
  }
  const read: ProjectFile[] = [];
  // By file identity, so two spellings of one file on a case-insensitive disk are one.
  const named = new Map<string, string>();
  for (const source of sources) {
    const file = projectRelativePath(source.path);
    if ('problem' in file) return refused(file.problem);
    const opened = await readProjectText(root, file.path);
    if ('problem' in opened) return refused(opened.problem);
    const earlier = named.get(opened.identity);
    if (earlier !== undefined)
      return refused(`${file.path} is named twice, as ${earlier}. Name each file once.`);
    named.set(opened.identity, file.path);
    read.push({ kind: source.kind, text: opened.text, file: file.path });
  }
  return { status: 'read', sources: read };
}

function refused(message: string): ProjectRead {
  return { status: 'refused', message };
}
