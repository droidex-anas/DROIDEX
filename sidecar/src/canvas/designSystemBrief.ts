// The pinned kit as a turn's first canvas_read carries it, so the agent can
// follow the kit without fetching it: name, mode, token names by section kind,
// the primitives its entry exports and its guidance. Token values, files and
// examples stay with canvas_theme. The kit schema caps the notes and usage notes
// the guidance carries at 16 KiB, not counting its headings, and the name lists
// share 4 KiB. Under Auto, before a project chat's first design, it also asks
// the agent to offer a kit from the project.

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
import { isFileSystemError } from './projectPaths.js';
import type { DesignSystemRef } from './protocol.js';

/** What the name lists may cost, counting the JSON quotes, commas and keys around them. */
const NAME_LIST_BYTES = 4 * 1024;

export interface DesignSystemBrief {
  ref: DesignSystemRef;
  name: string;
  primitives: string[];
  /** Token names by the kind of section that holds them, in document order. */
  tokens: Partial<Record<TokenSectionKind, string[]>>;
  /** Names left out to keep the brief bounded; canvas_theme read lists them all. */
  omittedNames?: number;
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
  // Names are listed in order until one does not fit, primitives first: they
  // are what a design builds with.
  let budget = NAME_LIST_BYTES;
  let omittedNames = 0;
  const fits = (name: string, keyBytes = 0): boolean => {
    const cost = Buffer.byteLength(name, 'utf8') + 3 + keyBytes;
    if (omittedNames > 0 || cost > budget) {
      omittedNames += 1;
      return false;
    }
    budget -= cost;
    return true;
  };
  const primitives = kitPrimitives(system).filter((name) => fits(name));
  const tokens: DesignSystemBrief['tokens'] = {};
  for (const [kind, names] of tokenNamesByKind(system.sections)) {
    // A kind's first name also pays for its key: `"kind":[],`.
    const keyBytes = Buffer.byteLength(kind, 'utf8') + 6;
    const listed = names.filter((name, index) => fits(name, index === 0 ? keyBytes : 0));
    if (listed.length > 0) tokens[kind] = listed;
  }
  const guidance = kitGuidance(system.name, system.sections);
  let offer: string | null = null;
  if (designSystemKind(ref.id) === 'auto' && board.projectFolder !== null && !board.hasDesigns)
    offer = projectKitOffer(await hasShadcnLibrary(board.projectFolder));
  return {
    ref,
    name: system.name,
    primitives,
    tokens,
    ...(omittedNames > 0 ? { omittedNames } : {}),
    guidance: offer === null ? guidance : `${guidance}\n\n${offer}`,
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
