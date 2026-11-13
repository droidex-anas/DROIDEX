// The Components tab's rows and its landing line: which kit catalog entries a
// search finds, best first, and where an added entry goes in the layer it is
// added to. The landing is read off the outline the way the sidecar writes the
// entry, so the line says so before Enter; the sidecar still has the last word.

import type { PropPick } from '../elementEditProtocol';
import { holdsLayers } from '../layers/layerMoves';
import type { CatalogListing, OutlineNode } from '../protocol';

/** Where an added entry goes: last inside the layer, right after it, or nowhere and why. */
export type Landing =
  | { kind: 'inside' | 'after'; name: string }
  | { kind: 'refused'; reason: string };

/**
 * The entries a search finds, best first: a name starting with it, then a
 * word in a name starting with it, then a name holding it, then its file's
 * name or its note holding it. The catalog's own order breaks ties.
 */
export function paletteRows(catalog: readonly CatalogListing[], query: string): CatalogListing[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...catalog];
  const ranked = catalog.flatMap((entry, index) => {
    const rank = matchRank(entry, needle);
    return rank === null ? [] : [{ entry, rank, index }];
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map(({ entry }) => entry);
}

function matchRank(entry: CatalogListing, needle: string): number | null {
  const name = entry.name.toLowerCase();
  if (name.startsWith(needle)) return 0;
  if (words(entry.name).some((word) => word.startsWith(needle))) return 1;
  if (name.includes(needle)) return 2;
  const elsewhere = [fileName(entry.module), entry.note].some((text) =>
    text?.toLowerCase().includes(needle),
  );
  return elsewhere ? 3 : null;
}

/** The options a row's variant menu has picked, by prop name. */
export type ChosenProps = Readonly<Partial<Record<string, string>>>;

/**
 * The props an insert writes for a row's picks: each picked option the entry
 * still lists, where it differs from what the entry writes anyway.
 */
export function propPicks(entry: CatalogListing, chosen: ChosenProps): PropPick[] {
  return entry.props.flatMap(({ name, options, default: written }) => {
    const value = chosen[name];
    if (value === undefined || value === written || !options.includes(value)) return [];
    return [{ name, value }];
  });
}

/** components/ui/alert-dialog.tsx is alert-dialog: the folder and extension match every entry. */
function fileName(module: string | null): string | null {
  return (
    module
      ?.split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '') ?? null
  );
}

/** "AlertDialog with icon" is alert, dialog, with and icon; "XMLHttpRequest" is xml, http and request. */
function words(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

/** Where an entry added to the outline row `node` lands, as the sidecar decides it. */
export function landingOf(nodes: readonly OutlineNode[], node: OutlineNode): Landing {
  const byId = new Map(nodes.map((each) => [each.nodeId, each]));
  const holders: OutlineNode[] = [];
  for (let at = parentOf(byId, node); at; at = parentOf(byId, at)) holders.push(at);
  const inVector = [node, ...holders].some(
    (each) => each.kind === 'element' && each.name === 'svg',
  );
  // Code decides whether a layer it writes renders, as `{open && <section />}` does,
  // so only a free layer or the frame's top layer takes the entry inside.
  if (holdsLayers(node) && !inVector && (node.free || node.parentId === null))
    return { kind: 'inside', name: node.name };
  if (node.parentId === null && !node.free)
    return refused(
      node.text === null
        ? 'This frame’s top layer can’t hold other layers.'
        : 'This frame’s top layer holds text. Pick a layer that holds others.',
    );
  if (node.lock === 'repeated')
    return refused('Written once and repeated for each item. Ask the agent to change it.');
  if (node.lock === 'shared') return refused('Used in several places. Ask the agent to change it.');
  if (!node.free)
    return refused(
      'This layer is written inside code (a list, a condition or a prop). Ask the agent to add to it.',
    );
  const parent = holders.at(0);
  if (parent && parent.text !== null)
    return refused('This layer sits inside text. Pick a layer that holds others.');
  if (inVector) return refused('This layer is part of a vector. Pick a layer outside it.');
  return { kind: 'after', name: node.name };
}

export function landingHint(landing: Landing): string {
  if (landing.kind === 'refused') return landing.reason;
  return `Adds ${landing.kind} ${landing.name}`;
}

function parentOf(byId: ReadonlyMap<string, OutlineNode>, node: OutlineNode) {
  return node.parentId === null ? undefined : byId.get(node.parentId);
}

function refused(reason: string): Landing {
  return { kind: 'refused', reason };
}
