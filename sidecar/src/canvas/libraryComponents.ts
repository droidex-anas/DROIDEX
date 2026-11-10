// A shadcn/ui library's components as kit files: each copied with its `@/`
// imports pointed at the kit's own files and its "use client" directive gone,
// and an entry that exports what each exports. An import the canvas cannot load
// is found by a line scan, as the kit entry's exports are (designSystemBrief.ts).

import { DESIGN_PACKAGE_ENTRIES } from './designPackages.js';
import { moduleExports } from './designSystemBrief.js';
import { MAX_LIBRARY_EXPORTS } from './designSystemProvenance.js';
import { withKitTokens } from './libraryTheme.js';
import type { CanvasDiagnostic } from './protocol.js';

/** Where the kit keeps the library's cn() helper. */
export const KIT_UTILS_FILE = 'lib/utils.ts';
export const COMPONENT_NAME = /^[a-z0-9][a-z0-9-]*$/i;

const UI_FOLDER = 'components/ui';
// The clause before `from` holds only names, braces and commas, so `Array.from('x')` is no import.
const IMPORT_SPECIFIER =
  /(?:\b(?:import|export)\s+(?:[\w*{}\s,$]*?\s)?from\s*|\bimport\s*)(['"])([^'"\n]+)\1/g;
const USE_CLIENT = /^\s*(['"])use client\1;?[^\S\n]*\n?/;

/** A component file of the library's ui folder. */
export interface LibraryComponent {
  /** Its file name without `.tsx`, which is also its name in the kit's ui folder. */
  name: string;
  file: string;
  text: string;
}

/** The import specifiers components.json names the ui folder and cn() helper by. */
export interface LibraryAliases {
  ui: string;
  utils: string;
}

interface KitModule {
  file: string;
  source: string;
  /** The other components it imports, by name. */
  needs: string[];
}

/**
 * The components as kit files and the entry that exports them. One that
 * imports what the canvas cannot load is left out, and so is one that needs a
 * component left out, until none does.
 */
export function kitComponents(
  library: readonly LibraryComponent[],
  aliases: LibraryAliases,
  kitNames: Readonly<Record<string, string>>,
  diagnostics: CanvasDiagnostic[],
): { entry: string; files: [string, string][]; components: Record<string, string> } {
  const modules = new Map<string, KitModule>();
  for (const component of library) {
    const module = kitModule(component, aliases, kitNames);
    if ('problem' in module)
      diagnostics.push({
        code: 'unsupported_import',
        message: module.problem,
        file: component.file,
      });
    else modules.set(component.name, module);
  }
  for (let removed = true; removed; ) {
    removed = false;
    for (const [name, module] of modules) {
      const missing = module.needs.find((need) => !modules.has(need));
      if (missing === undefined) continue;
      diagnostics.push({
        code: 'unsupported_import',
        message: `${module.file} was left out: it imports ${missing}, which was left out.`,
        file: module.file,
      });
      modules.delete(name);
      removed = true;
    }
  }
  const components: Record<string, string> = {};
  const lines: string[] = [];
  const files: [string, string][] = [];
  for (const [name, module] of modules) {
    const exported = moduleExports(module.source).filter((each) => {
      if (Object.keys(components).length >= MAX_LIBRARY_EXPORTS) return false;
      if (!Object.hasOwn(components, each)) return true;
      diagnostics.push({
        code: 'invalid_input',
        message: `${module.file} exports ${each}, as ${components[each]} does; the kit exports the first.`,
        file: module.file,
      });
      return false;
    });
    for (const each of exported) components[each] = module.file;
    if (exported.length > 0)
      lines.push(`export { ${exported.join(', ')} } from './${UI_FOLDER}/${name}';`);
    files.push([`${UI_FOLDER}/${name}.tsx`, module.source]);
  }
  return { entry: `${lines.join('\n')}\n`, files, components };
}

/** A component with its imports pointed at the kit's files, or why the canvas cannot load it. */
function kitModule(
  component: LibraryComponent,
  aliases: LibraryAliases,
  kitNames: Readonly<Record<string, string>>,
): KitModule | { problem: string } {
  const needs: string[] = [];
  for (const specifier of importSpecifiers(component.text)) {
    const kitSpecifier = componentSpecifier(specifier, aliases);
    if (kitSpecifier === null)
      return {
        problem: `${component.file} was left out: it imports ${specifier}, which the canvas cannot load.`,
      };
    if (kitSpecifier.startsWith('./')) needs.push(kitSpecifier.slice('./'.length));
  }
  const source = withKitTokens(component.text, kitNames)
    .replace(USE_CLIENT, '')
    .replace(IMPORT_SPECIFIER, (statement, quote: string, specifier: string) => {
      const kitSpecifier = componentSpecifier(specifier, aliases) ?? specifier;
      return statement.replace(`${quote}${specifier}${quote}`, `${quote}${kitSpecifier}${quote}`);
    });
  return { file: component.file, source, needs };
}

export function importSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[2]);
}

/** Where an import of a library component points in the kit, or null for one the canvas cannot load. */
function componentSpecifier(specifier: string, aliases: LibraryAliases): string | null {
  if (specifier === aliases.utils) return `../../${KIT_UTILS_FILE.replace(/\.ts$/, '')}`;
  let sibling: string | null = null;
  if (specifier.startsWith(`${aliases.ui}/`)) sibling = specifier.slice(aliases.ui.length + 1);
  else if (specifier.startsWith('./')) sibling = specifier.slice('./'.length);
  if (sibling !== null) return COMPONENT_NAME.test(sibling) ? `./${sibling}` : null;
  return DESIGN_PACKAGE_ENTRIES.has(specifier) ? specifier : null;
}
