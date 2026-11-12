// The pinned kit as a turn's first canvas_read carries it, so the agent can
// follow the kit without fetching it: name, mode, token names by section kind,
// the primitives its entry exports, its catalog's entry names and its guidance.
// Token values, files, examples and entry JSX stay with canvas_theme. The kit
// schema caps the notes and usage notes the guidance carries at 16 KiB, not
// counting its headings, and the name lists share 4 KiB; the catalog's entry
// names have 1 KiB of their own. Under Auto, before a project chat's first
// design, it also asks the agent to offer a kit from the project.

import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { CanvasCommandError } from './canvasError.js';
import { kitGuidance, type TokenSectionKind } from './designSystemDocument.js';
import {
  designSystemKind,
  KIT_ENTRY,
  readDesignSystem,
  type DesignSystem,
} from './designSystems.js';
import { readKitCatalog } from './kitCatalog.js';
import { isFileSystemError } from './projectPaths.js';
import type { DesignSystemRef } from './protocol.js';

/** What the name lists may cost, counting the JSON quotes, commas and keys around them. */
const NAME_LIST_BYTES = 4 * 1024;
/** What the catalog's entry names may cost, apart from the other names. */
const CATALOG_NAME_BYTES = 1024;

export interface DesignSystemBrief {
  ref: DesignSystemRef;
  name: string;
  primitives: string[];
  /** Token names by the kind of section that holds them, in document order. */
  tokens: Partial<Record<TokenSectionKind, string[]>>;
  /** Names left out to keep the brief bounded; canvas_theme read lists them all. */
  omittedNames?: number;
  /** The names of the kit's catalog entries, whose JSX canvas_theme catalog reads. */
  catalog?: string[];
  /** Entry names left out to keep the brief bounded; canvas_theme catalog lists them all. */
  omittedCatalogNames?: number;
  /** Why the kit's catalog.json is unusable, as canvas_theme catalog refuses it. */
  catalogProblem?: string;
  guidance: string;
}

function projectKitOffer(hasLibrary: boolean): string {
  const sources = hasLibrary
    ? 'shadcn/ui components, with their tokens and Tailwind theme,'
    : 'Tailwind config, CSS tokens and design docs';
  return `This chat has a project folder and its canvas has no design yet: unless the user asked for a design system, do what they ask and offer in one sentence of your reply to build one from the project's ${sources} for the designs that follow. Build it only when the user says so.`;
}

/** Where the turn starts: the chat's project folder, if any, and whether its canvas has a design. */
export interface OpeningBoard {
  projectFolder: string | null;
  hasDesigns: boolean;
}

/** A pinned kit this machine cannot read, missing or damaged; its builds report the same. */
interface UnavailableDesignSystem {
  ref: DesignSystemRef;
  unavailable: string;
}

export async function designSystemBrief(
  ref: DesignSystemRef,
  board: OpeningBoard,
): Promise<DesignSystemBrief | UnavailableDesignSystem> {
  let system: DesignSystem;
  try {
    system = await readDesignSystem(ref);
  } catch (error) {
    // The turn still needs its scope, if only to apply another kit, so an
    // unreadable kit is reported rather than thrown.
    if (error instanceof CanvasCommandError) return { ref, unavailable: error.message };
    throw error;
  }
  // Primitives come first: they are what a design builds with.
  const names = nameBudget(NAME_LIST_BYTES);
  const primitives = kitPrimitives(system).filter((name) => names.fits(name));
  const tokens: DesignSystemBrief['tokens'] = {};
  for (const [kind, kindNames] of tokenNamesByKind(system.sections)) {
    // A kind's first name also pays for its key: `"kind":[],`.
    const keyBytes = Buffer.byteLength(kind, 'utf8') + 6;
    const listed = kindNames.filter((name, index) => names.fits(name, index === 0 ? keyBytes : 0));
    if (listed.length > 0) tokens[kind] = listed;
  }
  // A saved version's catalog was checked when it was saved, but a v1.6
  // version converted on read may hold a catalog.json that is not one.
  const read = readKitCatalog(system.files);
  const entryNames = nameBudget(CATALOG_NAME_BYTES);
  const catalogKeyBytes = '"catalog":[],'.length;
  const catalog =
    'catalog' in read
      ? read.catalog
          .map(({ name }) => name)
          .filter((name, index) => entryNames.fits(name, index === 0 ? catalogKeyBytes : 0))
      : [];
  const guidance = kitGuidance(system.name, system.sections);
  let offer: string | null = null;
  if (designSystemKind(ref.id) === 'auto' && board.projectFolder !== null && !board.hasDesigns)
    offer = projectKitOffer(await hasShadcnLibrary(board.projectFolder));
  return {
    ref,
    name: system.name,
    primitives,
    tokens,
    ...(names.omitted() > 0 ? { omittedNames: names.omitted() } : {}),
    ...(catalog.length > 0 ? { catalog } : {}),
    ...(entryNames.omitted() > 0 ? { omittedCatalogNames: entryNames.omitted() } : {}),
    ...('problem' in read ? { catalogProblem: read.problem } : {}),
    guidance: offer === null ? guidance : `${guidance}\n\n${offer}`,
  };
}

/** Admits names in order until one does not fit in `bytes`, then only counts the rest. */
function nameBudget(bytes: number) {
  let left = bytes;
  let omitted = 0;
  return {
    /** Whether the name is listed; `keyBytes` is what its list's key costs with it. */
    fits(name: string, keyBytes = 0): boolean {
      // The name as JSON writes it, escapes and quotes included, and its comma.
      const cost = Buffer.byteLength(JSON.stringify(name), 'utf8') + 1 + keyBytes;
      if (omitted > 0 || cost > left) {
        omitted += 1;
        return false;
      }
      left -= cost;
      return true;
    },
    omitted: () => omitted,
  };
}

/** Whether the folder keeps a shadcn/ui library's components.json at its root, as the import reads it: no link. */
async function hasShadcnLibrary(folder: string): Promise<boolean> {
  try {
    return (await lstat(path.join(folder, 'components.json'))).isFile();
  } catch (error) {
    if (isFileSystemError(error)) return false;
    throw error;
  }
}

function tokenNamesByKind(sections: DesignSystem['sections']): [TokenSectionKind, string[]][] {
  const byKind: [TokenSectionKind, string[]][] = [];
  for (const section of sections) {
    if (section.kind === 'notes' || section.kind === 'components' || section.kind === 'assets')
      continue;
    const names = section.items.flatMap((item) =>
      item.kind === 'group' ? item.tokens.map((token) => token.name) : [],
    );
    if (names.length > 0) byKind.push([section.kind, names]);
  }
  return byKind;
}

// Kit entries are plain module source, so a line-anchored scan reads their
// exports without loading a parser into the sidecar's main process.
const EXPORTED_DECLARATION =
  /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}/gm;

/** The value names the kit entry exports: its primitives, in source order. */
export function kitPrimitives(system: Pick<DesignSystem, 'files'>): string[] {
  const entry = system.files[KIT_ENTRY];
  const found: { name: string; offset: number }[] = [];
  for (const match of entry.matchAll(EXPORTED_DECLARATION))
    found.push({ name: match[1], offset: match.index });
  for (const match of entry.matchAll(EXPORT_LIST)) {
    for (const specifier of match[1].split(',')) {
      const parts = specifier.trim().split(/\s+/);
      // `type Props` exports nothing at run time; `Button as Primary` exports Primary.
      if (parts[0] === '' || parts[0] === 'type') continue;
      found.push({ name: parts[parts.length - 1], offset: match.index });
    }
  }
  return found.sort((left, right) => left.offset - right.offset).map(({ name }) => name);
}
