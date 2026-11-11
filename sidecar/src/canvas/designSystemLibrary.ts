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
import postcss from 'postcss';
import { z } from 'zod';
import { boundDiagnostics } from './canvasDiagnostics.js';
import { readModules } from './compiler.js';
import { readConfigBindings, type ConfigValue } from './configLiterals.js';
import { DESIGN_PACKAGE_ENTRIES } from './designPackages.js';
import { importDesignSystem, type ImportDesignSystemResult } from './designSystemImport.js';
import { MAX_LIBRARY_SKIPS, type LibrarySkip } from './designSystemProvenance.js';
import { designSystemSchema, KIT_ENTRY } from './designSystems.js';
import { KIT_CATALOG_FILE } from './kitCatalog.js';
import { KIT_THEME_FILE } from './kitTailwindTheme.js';
import { seedLibraryCatalog } from './libraryCatalog.js';
import {
  COMPONENT_NAME,
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
import type { SourceFiles } from './schema.js';

/**
 * Of a kit's files, these many are the library's components, and the rest its
 * own: half again shadcn/ui's 61-file ui folder.
 */
export const MAX_LIBRARY_COMPONENTS = 96;
export const TAILWIND_4_REFUSAL =
  'This project uses Tailwind 4. The canvas builds with Tailwind 3.4, so its kit cannot be imported yet.';

const TAILWIND_4_VERSION = /^[\s^~>=v]*4(?:\.|$)/;

const componentsConfigSchema = z.object({
  tsx: z.boolean().optional(),
  tailwind: z.object({
    config: z.string().optional(),
    css: z.string().min(1),
    prefix: z.string().optional(),
    cssVariables: z.boolean().optional(),
  }),
  aliases: z.object({
    components: z.string().min(1),
    utils: z.string().min(1),
    ui: z.string().min(1).optional(),
  }),
});

const tailwindDependency = z.object({ tailwindcss: z.string().optional() }).optional();
const packageJsonSchema = z.object({
  dependencies: tailwindDependency,
  devDependencies: tailwindDependency,
});

interface LibraryRead {
  /** The project files the kit names as its source, components.json first. */
  files: string[];
  css: LibraryFile;
  config: LibraryFile;
  utils: string;
  components: LibraryComponent[];
  /** The ui folder's files left out before any was parsed. */
  skipped: LibrarySkip[];
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
  if ('problem' in theme) return refused(theme.problem, diagnostics);
  const stylesheet = libraryStylesheet(read.css, kitNames, diagnostics);
  const library = kitComponents(read.components, read.aliases, kitNames, diagnostics);
  if ('problem' in library) return refused(library.problem, diagnostics);
  const skipped = [...read.skipped, ...library.skipped].sort((left, right) =>
    left.file.localeCompare(right.file),
  );
  const files: SourceFiles = {
    [KIT_ENTRY]: library.entry,
    'fonts.css': inter.css,
    'fonts/Inter-OFL.txt': inter.license,
    ...(stylesheet === '' ? {} : { 'styles.css': stylesheet }),
    [KIT_THEME_FILE]: `${JSON.stringify(theme.theme, null, 2)}\n`,
    [KIT_UTILS_FILE]: read.utils,
    ...Object.fromEntries(library.files),
  };
  const catalog = seedLibraryCatalog(files);
  if (catalog !== null) files[KIT_CATALOG_FILE] = catalog;
  const parsed = designSystemSchema.safeParse({
    ...imported.system,
    // The shared primitives are not this kit's, so neither are their notes and previews.
    sections: imported.system.sections.filter((section) => section.kind !== 'components'),
    files,
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
          skipped: skipped.slice(0, MAX_LIBRARY_SKIPS),
          skippedCount: skipped.length,
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
  if (!settings.tailwind.config || (await usesTailwind4(root, base, css.text)))
    return { problem: TAILWIND_4_REFUSAL };
  const config = await readFile(root, base, settings.tailwind.config);
  if ('problem' in config) return config;
  const code = await readAliasedCode(root, base, settings.aliases);
  if ('problem' in code) return code;
  const diagnostics: CanvasDiagnostic[] = [];
  const folder = await readComponents(root, code.uiFolder, diagnostics);
  if ('problem' in folder) return folder;
  const [utilsModule, ...modules] = await readModules([
    code.utils.text,
    ...folder.components.map((component) => component.text),
  ]);
  const unknown = utilsModule.specifiers.find(
    (specifier) => specifier.loads && !DESIGN_PACKAGE_ENTRIES.has(specifier.text),
  );
  if (unknown !== undefined)
    return { problem: `${code.utils.file} imports ${unknown.text}, which the canvas cannot load.` };
  const components = folder.components.map((component, index) => ({
    ...component,
    module: modules[index],
  }));
  return {
    files: [configFile, css.file, config.file, code.tsconfig, code.utils.file],
    css,
    config,
    utils: code.utils.text,
    components,
    skipped: folder.skipped,
    aliases: code.aliases,
    diagnostics,
  };
}

/** Where components.json's aliases point, through the tsconfig.json beside it. */
interface AliasLayout {
  tsconfig: string;
  paths: PathMapping[];
  aliases: LibraryAliases;
  uiFolder: string;
}

export type LibraryLayout = AliasLayout & { css: LibraryFile };

/**
 * The library's aliases, the ui folder and the stylesheet, as components.json
 * and tsconfig.json say now, under the project's real `root`.
 */
export async function readLibraryLayout(
  root: string,
  componentsConfig: string,
): Promise<LibraryLayout | { problem: string }> {
  const settings = await readComponentsConfig(root, componentsConfig);
  if ('problem' in settings) return settings;
  const base = path.posix.dirname(componentsConfig);
  const css = await readFile(root, base, settings.tailwind.css);
  if ('problem' in css) return css;
  const layout = await readAliasLayout(root, base, settings.aliases);
  if ('problem' in layout) return layout;
  return { ...layout, css };
}

async function readAliasLayout(
  root: string,
  base: string,
  named: z.infer<typeof componentsConfigSchema>['aliases'],
): Promise<AliasLayout | { problem: string }> {
  const tsconfig = await readFile(root, base, 'tsconfig.json');
  if ('problem' in tsconfig)
    return { problem: `${tsconfig.problem} It says where components.json's aliases point.` };
  const paths = pathMappings(base, tsconfig.text);
  const aliases = { ui: named.ui ?? `${named.components}/ui`, utils: named.utils };
  const uiFolder = aliasPath(aliases.ui, paths, tsconfig.file);
  if ('problem' in uiFolder) return uiFolder;
  return { tsconfig: tsconfig.file, paths, aliases, uiFolder: uiFolder.path };
}

/** Where the library's aliases point, and its cn() helper. */
async function readAliasedCode(
  root: string,
  base: string,
  named: z.infer<typeof componentsConfigSchema>['aliases'],
): Promise<(AliasLayout & { utils: LibraryFile }) | { problem: string }> {
  const layout = await readAliasLayout(root, base, named);
  if ('problem' in layout) return layout;
  const utilsPath = aliasPath(layout.aliases.utils, layout.paths, layout.tsconfig);
  if ('problem' in utilsPath) return utilsPath;
  const utils = await readFile(root, '.', `${utilsPath.path}.ts`);
  if ('problem' in utils) return utils;
  return { ...layout, utils };
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
  const { tsx, tailwind } = parsed.data;
  if (tsx === false)
    return {
      problem: `${file} describes a JavaScript library; a kit copies TypeScript components.`,
    };
  if (tailwind.prefix)
    return {
      problem: `${file} sets tailwind.prefix to "${tailwind.prefix}", and a kit's classes take no prefix. Import a library that sets none.`,
    };
  if (tailwind.cssVariables === false)
    return {
      problem: `${file} sets tailwind.cssVariables to false, and a kit's tokens are the stylesheet's CSS variables. Import a library that keeps them.`,
    };
  return parsed.data;
}

/** Whether the library's stylesheet or the package.json beside components.json says it uses Tailwind 4. */
async function usesTailwind4(root: string, base: string, css: string): Promise<boolean> {
  if (hasTailwind4AtRules(css)) return true;
  const manifest = await readFile(root, base, 'package.json');
  if ('problem' in manifest) return false;
  let json: unknown;
  try {
    json = JSON.parse(manifest.text);
  } catch {
    return false;
  }
  const parsed = packageJsonSchema.safeParse(json);
  if (!parsed.success) return false;
  const { dependencies, devDependencies } = parsed.data;
  const version = dependencies?.tailwindcss ?? devDependencies?.tailwindcss;
  return version !== undefined && TAILWIND_4_VERSION.test(version);
}

// A stylesheet PostCSS cannot read is refused later, at its line.
function hasTailwind4AtRules(css: string): boolean {
  let root: postcss.Root;
  try {
    root = postcss.parse(css, { from: undefined, map: false });
  } catch (error) {
    if (!(error instanceof postcss.CssSyntaxError)) throw error;
    return false;
  }
  let found = false;
  root.walkAtRules((rule) => {
    if (
      rule.name === 'theme' ||
      (rule.name === 'import' && /^["']tailwindcss["']/.test(rule.params))
    )
      found = true;
  });
  return found;
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

/** The project path an import specifier names through tsconfig.json's paths. */
export function aliasPath(
  alias: string,
  mappings: readonly PathMapping[],
  tsconfig: string,
): { path: string } | { problem: string } {
  const exact = mappings.find(({ pattern }) => pattern === alias);
  if (exact !== undefined) return projectRelativePath(exact.target);
  // As TypeScript resolves it: the longest matching prefix, whatever order paths lists them in.
  const wildcard = mappings
    .filter(({ pattern }) => pattern.endsWith('*') && alias.startsWith(pattern.slice(0, -1)))
    .sort((a, b) => b.pattern.length - a.pattern.length)
    .at(0);
  if (wildcard !== undefined)
    return projectRelativePath(
      wildcard.target.replace('*', alias.slice(wildcard.pattern.length - 1)),
    );
  return { problem: `${tsconfig}'s paths do not say where ${alias} points.` };
}

function entry(value: ConfigValue | null | undefined, key: string): ConfigValue | null {
  if (value?.kind !== 'object') return null;
  return value.entries.find((each) => each.key === key)?.value ?? null;
}

/**
 * The ui folder's components, by name, up to the bound, and the files left
 * out: anything but a component file, one past the bound, one that cannot be read.
 */
async function readComponents(
  root: string,
  folder: string,
  diagnostics: CanvasDiagnostic[],
): Promise<
  { components: Omit<LibraryComponent, 'module'>[]; skipped: LibrarySkip[] } | { problem: string }
> {
  const names: string[] = [];
  const skipped: LibrarySkip[] = [];
  try {
    const real = await realpath(path.join(root, ...folder.split('/')));
    if (!isInsideProject(root, real))
      return { problem: `${folder} leaves the project folder. Name a folder inside it.` };
    for (const each of await readdir(real, { withFileTypes: true })) {
      // Hidden entries such as .DS_Store are the system's, not the library's.
      if (each.name.startsWith('.')) continue;
      const name = each.name.endsWith('.tsx') ? each.name.slice(0, -'.tsx'.length) : '';
      if (each.isFile() && COMPONENT_NAME.test(name)) names.push(name);
      else
        skipped.push({ file: `${folder}/${each.name}`, reason: 'not_a_component', detail: null });
    }
    names.sort();
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
  for (const name of names.slice(MAX_LIBRARY_COMPONENTS))
    skipped.push({ file: `${folder}/${name}.tsx`, reason: 'over_limit', detail: null });
  const components: Omit<LibraryComponent, 'module'>[] = [];
  for (const name of names.slice(0, MAX_LIBRARY_COMPONENTS)) {
    const file = `${folder}/${name}.tsx`;
    const read = await readProjectText(root, file);
    if ('problem' in read) {
      diagnostics.push({
        code: 'invalid_input',
        message: `${read.problem} It was left out.`,
        file,
      });
      skipped.push({ file, reason: 'unreadable', detail: null });
    } else components.push({ name, file, text: read.text });
  }
  return { components, skipped };
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
