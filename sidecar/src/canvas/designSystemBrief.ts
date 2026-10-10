// The pinned kit as a turn's first canvas_read carries it, so the agent can
// follow the kit without fetching it: name, mode, token names, the primitives
// its entry exports and its guidance. Token values, files and examples stay
// with canvas_theme. Guidance is capped at 16 KiB by the kit schema and the name
// lists share 4 KiB, so with the kit name a brief stays under 21 KiB.

import { CanvasCommandError } from './canvasError.js';
import { KIT_ENTRY, readDesignSystem, type DesignSystem } from './designSystems.js';
import type { DesignSystemRef } from './protocol.js';

const NAME_LIST_BYTES = 4 * 1024;

export interface DesignSystemBrief {
  ref: DesignSystemRef;
  name: string;
  primitives: string[];
  tokens: string[];
  /** Names left out to keep the brief bounded; canvas_theme read lists them all. */
  omittedNames?: number;
  guidance: string;
}

/** A pinned kit this machine no longer has; its builds report the same. */
interface UnavailableDesignSystem {
  ref: DesignSystemRef;
  unavailable: string;
}

export async function designSystemBrief(
  ref: DesignSystemRef,
): Promise<DesignSystemBrief | UnavailableDesignSystem> {
  let system: DesignSystem;
  try {
    system = await readDesignSystem(ref);
  } catch (error) {
    // The turn still needs its scope, so a missing kit is reported rather than thrown.
    if (error instanceof CanvasCommandError && error.code === 'version_mismatch')
      return { ref, unavailable: error.message };
    throw error;
  }
  const primitives = kitPrimitives(system);
  const tokens = Object.keys(system.modes[ref.mode]);
  // Primitives first: they are what a design builds with.
  const names = [...primitives, ...tokens];
  let listed = 0;
  let bytes = 0;
  while (listed < names.length) {
    bytes += Buffer.byteLength(names[listed], 'utf8') + 3;
    if (bytes > NAME_LIST_BYTES) break;
    listed += 1;
  }
  const omittedNames = names.length - listed;
  return {
    ref,
    name: system.name,
    primitives: primitives.slice(0, listed),
    tokens: tokens.slice(0, Math.max(0, listed - primitives.length)),
    ...(omittedNames > 0 ? { omittedNames } : {}),
    guidance: system.guidance,
  };
}

// Kit entries are plain module source, so a line-anchored scan reads their
// exports without loading a parser into the sidecar's main process.
const EXPORTED_DECLARATION =
  /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}/gm;

/** The value names the kit entry exports: its primitives, in source order. */
export function kitPrimitives(system: DesignSystem): string[] {
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
