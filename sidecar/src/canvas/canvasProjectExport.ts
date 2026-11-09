// Export to project: a frame's source export written into a folder of its
// chat's project, and what a kit read from a project became. The project
// folder comes from the session, never from the renderer; the renderer names
// only the folder inside it.

import { realpath } from 'node:fs/promises';
import { canvasError } from './canvasError.js';
import { isContractAlias } from './designSystemImport.js';
import { kitModes } from './designSystemDocument.js';
import type { DesignSystem } from './designSystems.js';
import { makeFolderInside, projectRelativePath } from './projectPaths.js';

export const NO_PROJECT_FOLDER =
  'This chat has no project folder. Start the chat in a project to export to it.';

/** A folder inside a chat's project, and the project's real path it must stay inside. */
export interface ProjectDestination {
  projectRoot: string;
  directory: string;
}

/** The export folder's real path inside the project, made with any missing parents. */
export async function projectExportDestination(
  projectFolder: string,
  folder: string,
  signal: AbortSignal,
): Promise<ProjectDestination> {
  const named = projectRelativePath(folder);
  if ('problem' in named) throw canvasError('invalid_input', named.problem);
  let root: string;
  try {
    root = await realpath(projectFolder);
  } catch {
    throw canvasError('invalid_input', 'The project folder cannot be read.');
  }
  const directory = await makeFolderInside(root, named.path, named.path, () => {
    signal.throwIfAborted();
  });
  return { projectRoot: root, directory };
}

/**
 * The README's account of what a kit read from a project became, or null for
 * any other kit. The kit keeps no original property names, only the normalised
 * aliases it made, so those are what the README names. Source is not rewritten:
 * an import can change a value on the way in (bare HSL channels gain `hsl()`),
 * and the export still builds on its own copy of the kit.
 */
export function projectMapping(kit: DesignSystem): string | null {
  const provenance = kit.provenance;
  if (!provenance || !('project' in provenance)) return null;
  const { name, files } = provenance.project;
  const { light, dark } = kitModes(kit.sections);
  const aliases = new Map<string, string[]>();
  for (const token of Object.keys(light)) {
    if (!isContractAlias(token, light[token]) || dark[token] !== light[token]) continue;
    const contract = light[token].slice('var('.length, -1);
    aliases.set(contract, [...(aliases.get(contract) ?? []), `\`${token}\``]);
  }
  const rows = Object.keys(light)
    .filter((token) => !isContractAlias(token, light[token]))
    .sort()
    .map((token) => `| \`${token}\` | ${aliases.get(token)?.join(', ') ?? 'none'} |`);
  return `
## Mapping to ${name}

This kit was read from ${files.map((file) => `\`${file}\``).join(', ')} in ${name}.

| Kit import | Became |
| --- | --- |
| \`@droidex/design-system\` | \`design-system/\`, copied |

The kit's components are DROIDEX's shared primitives styled with the project's
tokens, not the project's own components, so the source keeps importing the copy.

The import normalised the project's property names: lower case, with other
punctuation turned into hyphens, so \`--Brand_500\` became \`--brand-500\`. The
kit does not keep the original spelling. A property it matched to a kit token
stays as an alias of that token, usually with \`--ds-\` in front, so
\`--ds-primary\` refers to \`--ds-accent\`. One it did not match is a kit token of
its own, under its normalised name.

The source still uses the kit's names, because the import may have changed a
value on the way in (bare HSL channels are wrapped in \`hsl()\`). Compare the
values in \`canvas-export/modes.json\` before replacing a name with the project's.

| Kit token | Kit alias |
| --- | --- |
${rows.join('\n')}
`;
}
