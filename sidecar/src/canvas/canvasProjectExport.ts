// Export to project: a frame's source export written into a folder of its
// chat's project. The project folder comes from the session, never from the
// renderer; the renderer names only the folder inside it.

import { realpath } from 'node:fs/promises';
import { canvasError } from './canvasError.js';
import { makeFolderInside, projectRelativePath } from './projectPaths.js';

const NO_FOLDER = 'This chat has no project folder. Start the chat in a project to export to it.';

/** The export folder's real path inside the project, made with any missing parents. */
export async function projectExportDirectory(
  projectFolder: string | null,
  folder: string,
  signal: AbortSignal,
): Promise<string> {
  if (projectFolder === null) throw canvasError('invalid_input', NO_FOLDER);
  const named = projectRelativePath(folder);
  if ('problem' in named) throw canvasError('invalid_input', named.problem);
  let root: string;
  try {
    root = await realpath(projectFolder);
  } catch {
    throw canvasError('invalid_input', 'The project folder cannot be read.');
  }
  return makeFolderInside(root, named.path, named.path, () => {
    signal.throwIfAborted();
  });
}
