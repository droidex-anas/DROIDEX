// Export to project for a kit made from that project's shadcn/ui library: the
// source imports the project's own components and reads its own tokens, so
// the export carries no copy of the kit and no build of its own. When the
// library is no longer as the kit found it, the export copies the kit as any
// other does, and its README says why.

import { realpath } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import { codeSpan, markdownText } from './canvasProjectExport.js';
import type { ExportFile } from './canvasExport.js';
import { readModules } from './compiler.js';
import type { ModuleDeclarations } from './compilerModules.js';
import { KIT_SPECIFIER } from './designBundle.js';
import { kitGuidance, kitModes } from './designSystemDocument.js';
import { HIDDEN_RULE } from './designStylesheet.js';
import { isBareHsl } from './designSystemImport.js';
import { aliasPath, readLibraryLayout } from './designSystemLibrary.js';
import { bindingClause, entryExports, kitComponentPath, kitModule } from './libraryComponents.js';
import type { DesignSystem } from './designSystems.js';
import {
  emptyDeclared,
  readCss,
  tokenName,
  type Declared,
  type Mode,
} from './designSystemSources.js';
import { isFileSystemError, readProjectText } from './projectPaths.js';

export type LibraryExport =
  | { status: 'rewritten'; files: ExportFile[] }
  /** The README section that says why the kit is copied. */
  | { status: 'copied'; readme: string };

type KitProject = Extract<DesignSystem['provenance'], { project: unknown }>['project'];
type LibraryProject = KitProject & { library: NonNullable<KitProject['library']> };

/** The library as the project has it now. */
interface ProjectLibrary {
  projectName: string;
  /** The components.json alias that names the ui folder. */
  ui: string;
  /** The module the kit recorded for each component it exports. */
  modules: Readonly<Record<string, string>>;
  /**
   * For each of those modules, the specifier the project imports it by, and
   * the module's own name for each name the kit exports from it.
   */
  imports: Map<string, { specifier: string; bindings: Map<string, string> }>;
  declared: Declared;
  /** The stylesheet's spelling of each custom property it declares, by its kit spelling. */
  spellings: ReadonlyMap<string, string>;
}

const SCRIPT = /\.[jt]sx?$/;
// A reference, in the source's own hsl() or not, closes or goes on to its fallback.
const TOKEN_REFERENCE = /(\bhsla?\(\s*)?var\(\s*(--[\w-]+)\s*([),])/g;
const SINGLE_REFERENCE = /^var\(\s*(--[\w-]+)\s*\)$/;
const MAX_REFERENCE_HOPS = 8;
// A bare `hidden` attribute, as the layers panel writes one to hide a layer.
const BARE_HIDDEN = /\shidden(?=[\s/>])/;

/**
 * The export of `source` into the project at `projectFolder`, or null for a
 * kit not read from a library. It imports the project's components only when
 * every module the kit recorded is still a file in the library's ui folder.
 */
export async function libraryExport(
  projectFolder: string,
  kit: DesignSystem,
  source: ReadonlyMap<string, string>,
  signal?: AbortSignal,
): Promise<LibraryExport | null> {
  const project = kit.provenance && 'project' in kit.provenance ? kit.provenance.project : null;
  if (!project?.library) return null;
  const found = await readProjectLibrary(
    projectFolder,
    { ...project, library: project.library },
    kit.files,
    signal,
  );
  if ('problem' in found) return copied(found.problem);

  const scripts = [...source].filter(([file]) => SCRIPT.test(file));
  const modules = await readModules(
    scripts.map(([, text]) => text),
    signal,
  );
  const scriptModules = new Map(scripts.map(([file], index) => [file, modules[index]]));
  const tokens = new ProjectTokens(kit, project.library.tokens, found);
  const components = new Map<string, string>();
  const files: ExportFile[] = [];
  for (const [file, text] of source) {
    const module = scriptModules.get(file);
    const imported =
      module === undefined
        ? { text }
        : withProjectImports(`src/${file}`, text, module, found, components);
    if ('problem' in imported) return copied(imported.problem);
    files.push({ path: `src/${file}`, content: tokens.rewrite(imported.text) });
  }

  const css = tokens.unmappedCss();
  if (css !== '') files.push({ path: 'canvas-export/tokens.css', content: css });
  files.push({ path: 'canvas-export/guidance.md', content: kitGuidance(kit.name, kit.sections) });
  const hides = scripts.some(([, text]) => BARE_HIDDEN.test(text));
  files.push({ path: 'README.md', content: rewrittenReadme(found, components, tokens, hides) });
  return { status: 'rewritten', files };
}

async function readProjectLibrary(
  projectFolder: string,
  project: LibraryProject,
  kitFiles: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<ProjectLibrary | { problem: string }> {
  const { library } = project;
  let root: string;
  try {
    root = await realpath(projectFolder);
  } catch (error) {
    if (!isFileSystemError(error)) throw error;
    return { problem: 'The project folder cannot be read.' };
  }
  const layout = await readLibraryLayout(root, project.files[0]);
  if ('problem' in layout) return layout;
  const files = [...new Set(Object.values(library.components))];
  const texts: string[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    if (file !== `${layout.uiFolder}/${path.posix.basename(file)}`)
      return {
        problem: `${file} is no longer in ${layout.uiFolder}, the folder ${layout.aliases.ui} names.`,
      };
    const read = await readProjectText(root, file);
    if ('problem' in read) return read;
    texts.push(read.text);
  }
  const modules = await readModules(texts, signal);
  // The kit's copy of a component is the project's file as the import copied
  // it, so copying the file again proves it is the same component.
  const kitNames = Object.fromEntries(
    Object.entries(library.tokens).map(([kitName, projectName]) => [projectName, kitName]),
  );
  const { ui } = layout.aliases;
  if (ui.startsWith('.'))
    return {
      problem: `components.json names the ui folder by the relative path ${ui}, which would point inside the export's src/, not at ${layout.uiFolder}.`,
    };
  const imports: ProjectLibrary['imports'] = new Map();
  for (const [index, file] of files.entries()) {
    const name = path.posix.basename(file, '.tsx');
    const copy = kitModule(
      { name, file, text: texts[index], module: modules[index] },
      layout.aliases,
      kitNames,
    );
    if ('problem' in copy || copy.source !== kitFiles[kitComponentPath(name)])
      return {
        problem: `${file} is not the component the kit copied: it changed since the kit was made, or this is another project.`,
      };
    const specifier = `${ui}/${name}`;
    const target = aliasPath(specifier, layout.paths, layout.tsconfig);
    if ('problem' in target || `${target.path}.tsx` !== file)
      return {
        problem: `${specifier} does not lead to ${file} through ${layout.tsconfig}'s paths, so an import of it would not find the component.`,
      };
    const entries = entryExports(modules[index].exports, name);
    const bindings = new Map(entries.map(({ exportedName, binding }) => [exportedName, binding]));
    imports.set(file, { specifier, bindings });
  }
  const declared = emptyDeclared();
  const unreadable = readCss(
    layout.css.text,
    { file: layout.css.file, lineOffset: 0 },
    declared,
    [],
  );
  if (unreadable !== null) return { problem: `${layout.css.file}: ${unreadable.message}` };
  return {
    projectName: path.basename(root),
    ui,
    modules: library.components,
    imports,
    declared,
    spellings: declaredSpellings(layout.css.text),
  };
}

/** Custom properties the stylesheet spells one way, by their kit spelling. */
function declaredSpellings(css: string): Map<string, string> {
  const spellings = new Map<string, string | null>();
  postcss.parse(css, { from: undefined, map: false }).walkDecls((declaration) => {
    const name = declaration.variable ? tokenName(declaration.prop) : null;
    if (name === null) return;
    const known = spellings.get(name);
    spellings.set(
      name,
      known === undefined || known === declaration.prop ? declaration.prop : null,
    );
  });
  return new Map(
    [...spellings].flatMap(([name, spelling]) => (spelling === null ? [] : [[name, spelling]])),
  );
}

/**
 * The script with each kit import replaced by imports of the project modules
 * its names come from, each recorded in `components`.
 */
function withProjectImports(
  file: string,
  text: string,
  module: ModuleDeclarations,
  found: ProjectLibrary,
  components: Map<string, string>,
): { text: string } | { problem: string } {
  const kitImports = module.imports.filter((each) => each.specifier === KIT_SPECIFIER);
  const references = module.specifiers.filter((each) => each.text === KIT_SPECIFIER);
  if (references.length !== kitImports.length)
    return { problem: `${file} uses ${KIT_SPECIFIER} other than in an import.` };
  let rewritten = text;
  // From the last, so the earlier offsets still hold.
  for (const { start, end, names } of kitImports.reverse()) {
    if (names === null)
      return { problem: `${file} imports from ${KIT_SPECIFIER} other than values by name.` };
    // Every local name keeps its own clause, so `{ Card as A, Card as B }` binds both.
    const byModule = new Map<string, string[]>();
    for (const { imported, local } of names) {
      if (!Object.hasOwn(found.modules, imported))
        return {
          problem: `${file} imports ${imported}, which is not one of the library's components.`,
        };
      const moduleFile = found.modules[imported];
      const project = found.imports.get(moduleFile);
      const binding = project?.bindings.get(imported);
      if (project === undefined || binding === undefined)
        return { problem: `${moduleFile} no longer exports ${imported}.` };
      byModule.set(project.specifier, [
        ...(byModule.get(project.specifier) ?? []),
        bindingClause(binding, local),
      ]);
      components.set(imported, project.specifier);
    }
    const declarations = [...byModule].map(
      ([specifier, clauses]) => `import { ${clauses.join(', ')} } from '${specifier}';`,
    );
    rewritten = rewritten.slice(0, start) + declarations.join('\n') + rewritten.slice(end);
  }
  return { text: rewritten };
}

/**
 * The project token each kit token reads, and what the export's text read of
 * them: the kit token it was imported from, or, for a kit token that only
 * aliases another in both modes, the other's.
 */
class ProjectTokens {
  /** Each kit token the text read, and the reference to the project's that replaced it. */
  readonly used = new Map<string, string>();
  /** Kit tokens the text reads that keep their kit values, in tokens.css. */
  readonly unmapped = new Set<string>();
  private readonly modes: { light: Record<string, string>; dark: Record<string, string> };
  private readonly project = new Map<string, { name: string; isChannels: boolean }>();

  constructor(
    kit: DesignSystem,
    imported: Readonly<Record<string, string>>,
    { declared, spellings }: Pick<ProjectLibrary, 'declared' | 'spellings'>,
  ) {
    this.modes = kitModes(kit.sections);
    const names = new Map(Object.entries(imported));
    for (const [kitToken, projectName] of Object.entries(imported)) {
      if (!Object.hasOwn(this.modes.light, kitToken)) continue;
      const value = this.modes.light[kitToken];
      const aliased = SINGLE_REFERENCE.exec(value)?.[1];
      if (aliased !== undefined && this.modes.dark[kitToken] === value && !names.has(aliased))
        names.set(aliased, projectName);
    }
    for (const [kitToken, name] of names) {
      // A custom property's name is case-sensitive, so the reference needs the stylesheet's own spelling.
      const spelling = spellings.get(name);
      const light = modeValue(declared, name, 'light');
      const dark = modeValue(declared, name, 'dark');
      if (spelling === undefined || light === undefined || dark === undefined) continue;
      // shadcn's bare channels are a colour only inside hsl(), and one reference reads both modes.
      const isChannels = isBareHsl(light);
      if (isBareHsl(dark) === isChannels)
        this.project.set(kitToken, { name: spelling, isChannels });
    }
  }

  /** The text with each kit token it reads replaced by the project's; one with none is kept. */
  rewrite(text: string): string {
    return text.replace(
      TOKEN_REFERENCE,
      (reference: string, hsl: string | undefined, name: string, close: string) => {
        const token = this.project.get(name);
        const needsHsl = token?.isChannels === true && hsl === undefined;
        if (token === undefined || (close === ',' && needsHsl)) {
          if (Object.hasOwn(this.modes.light, name) || Object.hasOwn(this.modes.dark, name))
            this.unmapped.add(name);
          return reference;
        }
        const read = `var(${token.name}${close}`;
        this.used.set(name, token.isChannels ? `hsl(var(${token.name}))` : `var(${token.name})`);
        return needsHsl ? `hsl(${read})` : `${hsl ?? ''}${read}`;
      },
    );
  }

  /** The kit's values for the unmapped tokens, light on :root and dark on .dark as shadcn/ui sets them. */
  unmappedCss(): string {
    const values = { light: new Map<string, string>(), dark: new Map<string, string>() };
    // A kit value can read further kit tokens, which the loop then reaches too.
    for (const name of this.unmapped) {
      for (const mode of ['light', 'dark'] as const) {
        if (Object.hasOwn(this.modes[mode], name))
          values[mode].set(name, this.rewrite(this.modes[mode][name]));
      }
    }
    const rules = [
      [':root', values.light],
      ['.dark', values.dark],
    ] as const;
    return rules
      .filter(([, declarations]) => declarations.size > 0)
      .map(
        ([selector, declarations]) =>
          `${selector} {\n${[...declarations]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, value]) => `  ${name}: ${value};\n`)
            .join('')}}\n`,
      )
      .join('\n');
  }
}

/** The value a mode of the project reads for a token, through plain references to others. */
function modeValue(declared: Declared, name: string, mode: Mode): string | undefined {
  const { shared } = declared.scopes;
  const own = declared.scopes[mode];
  let current: string | null = name;
  for (let hop = 0; hop < MAX_REFERENCE_HOPS && current !== null; hop += 1) {
    const scope = Object.hasOwn(own, current) ? own : shared;
    if (!Object.hasOwn(scope, current)) return undefined;
    const next = SINGLE_REFERENCE.exec(scope[current])?.[1];
    if (next === undefined) return scope[current];
    current = tokenName(next);
  }
  return undefined;
}

function rewrittenReadme(
  found: ProjectLibrary,
  components: ReadonlyMap<string, string>,
  tokens: ProjectTokens,
  hides: boolean,
): string {
  const table = (header: string, rows: ReadonlyMap<string, string>) =>
    `${header}\n| --- | --- |\n${[...rows]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([from, to]) => `| \`${from}\` | ${codeSpan(to)} |`)
      .join('\n')}`;
  const sections = [
    `# Canvas source export

This revision was exported into ${markdownText(found.projectName)} to build with
the project's own shadcn/ui components, so it carries no copy of the kit and no
build of its own: the project's build and Tailwind config take it. It starts
at \`src/main.tsx\`. Its classes are left as written: one the kit's theme adds
for a token of its own, such as \`bg-surface\`, needs that key in the project's
Tailwind config.`,
  ];
  if (components.size > 0)
    sections.push(`Its \`${KIT_SPECIFIER}\` imports name the components the kit was made from,
through the ${codeSpan(found.ui)} alias in \`components.json\`:

${table('| Component | Import |', components)}`);
  if (tokens.used.size > 0)
    sections.push(`Its kit tokens read the project's own:

${table('| Kit token | Project token |', tokens.used)}`);
  if (tokens.unmapped.size > 0)
    sections.push(`These kit tokens have no project token, so \`canvas-export/tokens.css\` sets
their kit values, light on \`:root\` and dark on \`.dark\`: ${[...tokens.unmapped]
      .sort()
      .map((name) => `\`${name}\``)
      .join(', ')}.
Import it into the project's stylesheet, or replace them with the project's own tokens.`);
  if (hides)
    sections.push(`It hides layers with the \`hidden\` attribute. Tailwind 3 lets a display class
such as \`flex\` show such a layer anyway, so give the project's stylesheet this
rule if it lacks it:

\`\`\`css
${HIDDEN_RULE}\`\`\``);
  sections.push(`The kit's guidance is in \`canvas-export/guidance.md\`. The images the source
refers to are in \`assets/\`, named by their hash: serve them from the app and
point the source's \`canvas-asset:\` and \`kit-asset:\` references at them.`);
  return `${sections.join('\n\n')}\n`;
}

function copied(reason: string): LibraryExport {
  return {
    status: 'copied',
    readme: `
## Why the kit is copied

The kit was made from this project's shadcn/ui components, but the export
copies it into \`design-system/\` instead of importing them. ${reason}
`,
  };
}
