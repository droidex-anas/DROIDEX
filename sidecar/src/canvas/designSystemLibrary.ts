// A kit made from a project's shadcn/ui library (design system documents spec
// §12). components.json names the library's stylesheet, Tailwind config and
// folders: DROIDEX copies the library's components and its cn() helper into
// the kit with their `@/` imports pointed at the kit's own files, imports the
// stylesheet's custom properties as the kit's tokens, and keeps the config's
// theme as the kit's project theme over them (libraryComponents.ts and
// libraryTheme.ts). DROIDEX opens every file itself under the project folder's
// rules (projectPaths.ts), and nothing in the project runs.

import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { boundDiagnostics } from './canvasDiagnostics.js';
import { readConfigBindings, type ConfigValue } from './configLiterals.js';
import { DESIGN_PACKAGE_ENTRIES } from './designPackages.js';
import { importDesignSystem, type ImportDesignSystemResult } from './designSystemImport.js';
import { designSystemSchema, KIT_ENTRY } from './designSystems.js';
import { KIT_THEME_FILE } from './kitTailwindTheme.js';
import {
  COMPONENT_NAME,
  importSpecifiers,
  KIT_UTILS_FILE,
  kitComponents,
  type LibraryAliases,
  type LibraryComponent,
} from './libraryComponents.js';
import { libraryStylesheet, libraryTheme, type LibraryFile } from './libraryTheme.js';
import inter from './presets/fonts/inter.json' with { type: 'json' };
import {
  isFileSystemError,
  isInsideProject,
  projectRelativePath,
  readProjectText,
} from './projectPaths.js';
import type { CanvasDiagnostic } from './protocol.js';

/** A kit holds 64 files; these many are the library's components, and the rest its own. */
export const MAX_LIBRARY_COMPONENTS = 48;
export const TAILWIND_4_REFUSAL =
  'This project uses Tailwind 4. The canvas builds with Tailwind 3.4, so its kit cannot be imported yet.';

const TAILWIND_4_CSS = /@import\s+["']tailwindcss["']|@theme\b/;

const componentsConfigSchema = z.object({
  tsx: z.boolean().optional(),
  tailwind: z.object({ config: z.string().optional(), css: z.string().min(1) }),
  aliases: z.object({
    components: z.string().min(1),
    utils: z.string().min(1),
    ui: z.string().min(1).optional(),
  }),
});

interface LibraryRead {
  /** The project files the kit names as its source, components.json first. */
  files: string[];
  css: LibraryFile;
  config: LibraryFile;
  utils: string;
  components: LibraryComponent[];
  aliases: LibraryAliases;
  diagnostics: CanvasDiagnostic[];
}

/** A version-1 kit from the library components.json describes, or why it cannot be made. */
export async function importLibraryDesignSystem(
  projectRoot: string,
  componentsConfig: string,
  kit: { id: string; name: string },
): Promise<ImportDesignSystemResult> {
  const read = await readLibrary(projectRoot, componentsConfig);
  if ('problem' in read) return refused(read.problem);
  const imported = importDesignSystem([{ kind: 'css', ...read.css }], kit);
  if (imported.status === 'refused') return imported;
  const { kitNames } = imported;
  const diagnostics = [...read.diagnostics, ...imported.diagnostics];
  const theme = libraryTheme(read.config, kitNames, diagnostics);
  const stylesheet = libraryStylesheet(read.css, kitNames, diagnostics);
  const library = kitComponents(read.components, read.aliases, diagnostics);
  if (library.files.length === 0)
    return refused(`No component in ${read.aliases.ui} could be copied.`, diagnostics);
  const parsed = designSystemSchema.safeParse({
    ...imported.system,
    // The shared primitives are not this kit's, so neither are their notes and previews.
    sections: imported.system.sections.filter((section) => section.kind !== 'components'),
    files: {
      [KIT_ENTRY]: library.entry,
      'fonts.css': inter.css,
      'fonts/Inter-OFL.txt': inter.license,
      ...(stylesheet === '' ? {} : { 'styles.css': stylesheet }),
      [KIT_THEME_FILE]: `${JSON.stringify(theme, null, 2)}\n`,
      [KIT_UTILS_FILE]: read.utils,
      ...Object.fromEntries(library.files),
    },
    examples: {},
    provenance: {
      project: {
        name: path.basename(projectRoot),
        files: read.files,
        library: {
          kind: 'shadcn',
          components: library.components,
          tokens: Object.fromEntries(
            Object.entries(kitNames).map(([projectName, kitName]) => [kitName, projectName]),
          ),
        },
      },
    },
  });
  if (!parsed.success)
    return refused(parsed.error.issues[0]?.message ?? 'That library does not make a valid kit.');
  return {
    status: 'imported',
    system: parsed.data,
    diagnostics: boundDiagnostics(diagnostics),
    kitNames,
  };
}

async function readLibrary(
  projectRoot: string,
  componentsConfig: string,
): Promise<LibraryRead | { problem: string }> {
  const named = projectRelativePath(componentsConfig);
  if ('problem' in named) return named;
  let root: string;
  try {
    root = await realpath(projectRoot);
  } catch (error) {
    if (!isFileSystemError(error)) throw error;
    return { problem: 'The project folder cannot be read.' };
  }
  const configFile = named.path;
  const settings = await readComponentsConfig(root, configFile);
  if ('problem' in settings) return settings;
  // components.json names its files and tsconfig.json from its own folder.
  const base = path.posix.dirname(configFile);
  const css = await readFile(root, base, settings.tailwind.css);
  if ('problem' in css) return css;
  if (!settings.tailwind.config || TAILWIND_4_CSS.test(css.text))
    return { problem: TAILWIND_4_REFUSAL };
  const config = await readFile(root, base, settings.tailwind.config);
  if ('problem' in config) return config;
  const code = await readAliasedCode(root, base, settings.aliases);
  if ('problem' in code) return code;
  const diagnostics: CanvasDiagnostic[] = [];
  const components = await readComponents(root, code.uiFolder, diagnostics);
  if ('problem' in components) return components;
  return {
    files: [configFile, css.file, config.file, code.tsconfig, code.utils.file],
    css,
    config,
    utils: code.utils.text,
    components,
    aliases: code.aliases,
    diagnostics,
  };
}

/** Where the library's aliases point, through tsconfig.json, and its cn() helper. */
async function readAliasedCode(
  root: string,
  base: string,
  named: z.infer<typeof componentsConfigSchema>['aliases'],
): Promise<
  | { tsconfig: string; uiFolder: string; utils: LibraryFile; aliases: LibraryAliases }
  | { problem: string }
> {
  const tsconfig = await readFile(root, base, 'tsconfig.json');
  if ('problem' in tsconfig)
    return { problem: `${tsconfig.problem} It says where components.json's aliases point.` };
  const mappings = pathMappings(base, tsconfig.text);
  const aliases = { ui: named.ui ?? `${named.components}/ui`, utils: named.utils };
  const uiFolder = aliasPath(aliases.ui, mappings, tsconfig.file);
  if ('problem' in uiFolder) return uiFolder;
  const utilsPath = aliasPath(aliases.utils, mappings, tsconfig.file);
  if ('problem' in utilsPath) return utilsPath;
  const utils = await readFile(root, '.', `${utilsPath.path}.ts`);
  if ('problem' in utils) return utils;
  const unknown = importSpecifiers(utils.text).find(
    (specifier) => !DESIGN_PACKAGE_ENTRIES.has(specifier),
  );
  if (unknown !== undefined)
    return { problem: `${utils.file} imports ${unknown}, which the canvas cannot load.` };
  return { tsconfig: tsconfig.file, uiFolder: uiFolder.path, utils, aliases };
}

async function readComponentsConfig(
  root: string,
  file: string,
): Promise<z.infer<typeof componentsConfigSchema> | { problem: string }> {
  const read = await readProjectText(root, file);
  if ('problem' in read) return read;
  let json: unknown;
  try {
    json = JSON.parse(read.text);
  } catch {
    return { problem: `${file} is not JSON.` };
  }
  const parsed = componentsConfigSchema.safeParse(json);
  if (!parsed.success)
    return {
      problem: `${file} is not a shadcn/ui components.json: it needs tailwind.css, aliases.components and aliases.utils.`,
    };
  if (parsed.data.tsx === false)
    return {
      problem: `${file} describes a JavaScript library; a kit copies TypeScript components.`,
    };
  return parsed.data;
}

/** A file components.json names, relative to `base`, the folder it is in. */
async function readFile(
  root: string,
  base: string,
  named: string,
): Promise<LibraryFile | { problem: string }> {
  const file = projectRelativePath(path.posix.join(base, named));
  if ('problem' in file) return file;
  const read = await readProjectText(root, file.path);
  return 'problem' in read ? read : { text: read.text, file: file.path };
}

interface PathMapping {
  pattern: string;
  /** The project path its first target names. */
  target: string;
}

/** tsconfig.json's `paths`, from the folder it is in, `base`, and its `baseUrl`. */
function pathMappings(base: string, tsconfig: string): PathMapping[] {
  const read = readConfigBindings(tsconfig);
  const options =
    read.status === 'read' ? entry(read.bindings.at(0)?.value, 'compilerOptions') : null;
  const baseUrl = entry(options, 'baseUrl');
  const from = path.posix.join(base, baseUrl?.kind === 'text' ? baseUrl.value : '.');
  const paths = entry(options, 'paths');
  return (paths?.kind === 'object' ? paths.entries : []).flatMap(({ key, value }) => {
    const target = value.kind === 'list' ? value.items.at(0) : undefined;
    if (key === null || target?.kind !== 'text') return [];
    return [{ pattern: key, target: path.posix.join(from, target.value) }];
  });
}

function aliasPath(
  alias: string,
  mappings: readonly PathMapping[],
  tsconfig: string,
): { path: string } | { problem: string } {
  for (const { pattern, target } of mappings) {
    if (pattern === alias) return projectRelativePath(target);
    if (pattern.endsWith('*') && alias.startsWith(pattern.slice(0, -1)))
      return projectRelativePath(target.replace('*', alias.slice(pattern.length - 1)));
  }
  return { problem: `${tsconfig}'s paths do not say where ${alias} points.` };
}

function entry(value: ConfigValue | null | undefined, key: string): ConfigValue | null {
  if (value?.kind !== 'object') return null;
  return value.entries.find((each) => each.key === key)?.value ?? null;
}

/** The ui folder's components, by name, up to the bound; one that cannot be read is left out. */
async function readComponents(
  root: string,
  folder: string,
  diagnostics: CanvasDiagnostic[],
): Promise<LibraryComponent[] | { problem: string }> {
  let names: string[];
  try {
    const real = await realpath(path.join(root, ...folder.split('/')));
    if (!isInsideProject(root, real))
      return { problem: `${folder} leaves the project folder. Name a folder inside it.` };
    const entries = await readdir(real, { withFileTypes: true });
    names = entries
      .filter((each) => each.isFile() && each.name.endsWith('.tsx'))
      .map((each) => each.name.slice(0, -'.tsx'.length))
      .filter((name) => COMPONENT_NAME.test(name))
      .sort();
  } catch (error) {
    if (!isFileSystemError(error)) throw error;
    return { problem: `${folder} cannot be read as the library's ui folder.` };
  }
  if (names.length === 0) return { problem: `${folder} has no components to copy.` };
  if (names.length > MAX_LIBRARY_COMPONENTS)
    diagnostics.push({
      code: 'invalid_input',
      message: `${folder} has ${String(names.length)} components; a kit copies the first ${String(MAX_LIBRARY_COMPONENTS)} by name and leaves out ${names.slice(MAX_LIBRARY_COMPONENTS).join(', ')}.`,
    });
  const components: LibraryComponent[] = [];
  for (const name of names.slice(0, MAX_LIBRARY_COMPONENTS)) {
    const file = `${folder}/${name}.tsx`;
    const read = await readProjectText(root, file);
    if ('problem' in read)
      diagnostics.push({
        code: 'invalid_input',
        message: `${read.problem} It was left out.`,
        file,
      });
    else components.push({ name, file, text: read.text });
  }
  return components;
}

function refused(
  message: string,
  earlier: CanvasDiagnostic[] = [],
): Extract<ImportDesignSystemResult, { status: 'refused' }> {
  return {
    status: 'refused',
    diagnostics: boundDiagnostics([{ code: 'invalid_input', message }, ...earlier]),
  };
}
