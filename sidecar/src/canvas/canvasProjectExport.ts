// Export to project: a frame's source export written into a folder of its
// chat's project, and what a kit imported from a project became. The project
// folder comes from the session, never from the renderer; the renderer names
// only the folder inside it.

import { realpath } from 'node:fs/promises';
import { canvasError } from './canvasError.js';
import { isContractAlias } from './designSystemImport.js';
import { kitModes } from './designSystemDocument.js';
import type { DesignSystem } from './designSystems.js';
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

/**
 * The README's account of what a kit imported from a project became, or null
 * for any other kit. Source is not rewritten to the project's names: an import
 * can change a value on the way in (bare HSL channels gain `hsl()`), and the
 * export still builds on its own copy of the kit, which defines only `--ds-*`.
 */
export function projectMapping(kit: DesignSystem): string | null {
  const provenance = kit.provenance;
  if (!provenance || !('project' in provenance)) return null;
  const { name, files } = provenance.project;
  const { light, dark } = kitModes(kit.sections);
  const importedAs = new Map<string, string[]>();
  for (const token of Object.keys(light)) {
    if (!isContractAlias(token, light[token]) || dark[token] !== light[token]) continue;
    const contract = light[token].slice('var('.length, -1);
    const projectToken = token.startsWith('--ds-') ? `--${token.slice('--ds-'.length)}` : token;
    importedAs.set(contract, [...(importedAs.get(contract) ?? []), projectToken]);
  }
  const rows: string[] = [];
  for (const token of Object.keys(light)) {
    if (importedAs.has(token) || isContractAlias(token, light[token])) continue;
    rows.push(`| \`${token}\` | unmapped |`);
  }
  for (const [contract, projectTokens] of importedAs) {
    // Two project names for one kit token would make either rewrite a guess.
    const project = projectTokens.length === 1 ? `\`${projectTokens[0]}\`` : 'unmapped';
    rows.push(`| \`${contract}\` | ${project} |`);
  }
  rows.sort();
  return `
## Mapping to ${name}

This kit was imported from ${files.map((file) => `\`${file}\``).join(', ')} in ${name}.

| Kit import | Became |
| --- | --- |
| \`@droidex/design-system\` | \`design-system/\`, copied |

The kit's components are DROIDEX's shared primitives styled with the project's
tokens, not the project's own components, so the source keeps importing the copy.

Each kit token and the project token it was imported from. The source still
uses the \`--ds-*\` names, because the import may have changed a value on the
way in (bare HSL channels are wrapped in \`hsl()\`). Compare the values in
\`canvas-export/modes.json\` before replacing a name. An unmapped token has no
single project name and stays as it is.

| Kit token | Project token |
| --- | --- |
${rows.join('\n')}
`;
}
