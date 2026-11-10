// A shadcn/ui library's components as kit files: each copied with its `@/`
// imports pointed at the kit's own files, its token references read as the
// kit's tokens and its "use client" directive gone, and an entry that exports
// what each exports, as the compiler process reads them (moduleDeclarations.ts).

import type { ModuleDeclarations, ModuleExport } from './compilerModules.js';
import { DESIGN_PACKAGE_ENTRIES } from './designPackages.js';
import { MAX_LIBRARY_EXPORTS } from './designSystemProvenance.js';
import { withKitTokens } from './libraryTheme.js';
import type { CanvasDiagnostic } from './protocol.js';

/** Where the kit keeps the library's cn() helper. */
export const KIT_UTILS_FILE = 'lib/utils.ts';
export const COMPONENT_NAME = /^[a-z0-9][a-z0-9-]*$/i;

const UI_FOLDER = 'components/ui';
const USE_CLIENT = /^\s*(['"])use client\1;?[^\S\n]*\n?/;
// A name the kit entry and its provenance can export.
const EXPORT_NAME = /^[A-Za-z$][\w$]*$/;

/** A component file of the library's ui folder. */
export interface LibraryComponent {
  /** Its file name without `.tsx`, which is also its name in the kit's ui folder. */
  name: string;
  file: string;
  text: string;
  /** What its text imports and exports. */
  module: ModuleDeclarations;
}

/** The import specifiers components.json names the ui folder and cn() helper by. */
export interface LibraryAliases {
  ui: string;
  utils: string;
}

interface KitModule {
  file: string;
  source: string;
  exports: ModuleExport[];
  /** The other components it imports, by name. */
  needs: string[];
}

/**
 * The components as kit files and the entry that exports them. One that
 * imports what the canvas cannot load is left out, and so is one that needs a
 * component left out, until none does. A library none of whose components
 * export anything the kit can name is refused.
 */
export function kitComponents(
  library: readonly LibraryComponent[],
  aliases: LibraryAliases,
  kitNames: Readonly<Record<string, string>>,
  diagnostics: CanvasDiagnostic[],
):
  | { entry: string; files: [string, string][]; components: Record<string, string> }
  | { problem: string } {
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
  if (modules.size === 0) return { problem: `No component in ${aliases.ui} could be copied.` };
  const components: Record<string, string> = {};
  const lines: string[] = [];
  const files: [string, string][] = [];
  let unnamed: string | null = null;
  for (const [name, module] of modules) {
    const exported = entryExports(module.exports, name).filter(({ exportedName }) => {
      if (Object.keys(components).length >= MAX_LIBRARY_EXPORTS) return false;
      if (!Object.hasOwn(components, exportedName)) return true;
      diagnostics.push({
        code: 'invalid_input',
        message: `${module.file} exports ${exportedName}, as ${components[exportedName]} does; the kit exports the first.`,
        file: module.file,
      });
      return false;
    });
    for (const { exportedName } of exported) components[exportedName] = module.file;
    if (exported.length > 0)
      lines.push(
        `export { ${exported.map(({ clause }) => clause).join(', ')} } from './${UI_FOLDER}/${name}';`,
      );
    else if (module.exports.length === 0) {
      unnamed ??= module.file;
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${module.file} exports nothing the kit recognises, so the kit's entry does not export it.`,
        file: module.file,
      });
    }
    files.push([`${UI_FOLDER}/${name}.tsx`, module.source]);
  }
  if (lines.length === 0)
    return {
      problem: `No component in ${aliases.ui} exports anything the kit recognises${unnamed === null ? '' : `, starting with ${unnamed}`}.`,
    };
  return { entry: `${lines.join('\n')}\n`, files, components };
}

/**
 * The exports the kit entry re-exports from one module, each once: a default
 * export by the name it declares, or else by the component's name in PascalCase.
 */
function entryExports(
  exports: readonly ModuleExport[],
  componentName: string,
): { exportedName: string; clause: string }[] {
  const entries = new Map<string, string>();
  for (const each of exports) {
    const exportedName = each.isDefault ? (each.name ?? pascalCase(componentName)) : each.name;
    if (!EXPORT_NAME.test(exportedName) || entries.has(exportedName)) continue;
    entries.set(exportedName, each.isDefault ? `default as ${exportedName}` : exportedName);
  }
  return [...entries].map(([exportedName, clause]) => ({ exportedName, clause }));
}

function pascalCase(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/** A component with its imports pointed at the kit's files, or why the canvas cannot load it. */
function kitModule(
  { file, text, module }: LibraryComponent,
  aliases: LibraryAliases,
  kitNames: Readonly<Record<string, string>>,
): KitModule | { problem: string } {
  const needs: string[] = [];
  const rewrites: { start: number; end: number; kitSpecifier: string }[] = [];
  for (const { text: specifier, start, end, loads } of module.specifiers) {
    const kitSpecifier = componentSpecifier(specifier, aliases);
    if (kitSpecifier === null) {
      if (!loads) continue;
      return {
        problem: `${file} was left out: it imports ${specifier}, which the canvas cannot load.`,
      };
    }
    if (loads && kitSpecifier.startsWith('./')) needs.push(kitSpecifier.slice('./'.length));
    rewrites.push({ start, end, kitSpecifier });
  }
  let source = text;
  // From the last, so the earlier offsets still hold.
  for (const { start, end, kitSpecifier } of rewrites.sort(
    (left, right) => right.start - left.start,
  ))
    source = source.slice(0, start) + kitSpecifier + source.slice(end);
  return {
    file,
    source: withKitTokens(source, kitNames).replace(USE_CLIENT, ''),
    exports: module.exports,
    needs,
  };
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
