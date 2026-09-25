import { menuMatchRank, rankMenuCandidates } from '../../lib/composerMenuRanking';
import { VISUALIZE_COMMAND } from '../../lib/composePrompt';
import { catalogRowKey } from './composerCatalog';
import type { SkillInfo } from '../../types/bridge';
import type { SlashCommand } from '../ComposerMenu';

const CATALOG_LIMIT = 40;
const FILE_LIMIT = 50;
// A file whose path matches the query but whose name does not still belongs in
// the list, below every file named for it.
const PATH_ONLY_RANK = 5;

export interface ComposerTrigger {
  kind: 'slash' | 'file';
  query: string;
  /** Where the token starts in the draft, so running a row can replace it. */
  start: number;
  end: number;
}

// A `/` or `@` token the caret is still inside opens the menu on what follows it.
export function composerTrigger(text: string, caret: number): ComposerTrigger | null {
  const upto = text.slice(0, caret);
  const m = /(^|\s)([/@][^\s]*)$/.exec(upto);
  if (!m) return null;
  const token = m[2];
  return {
    kind: token.startsWith('/') ? 'slash' : 'file',
    query: token.slice(1),
    start: caret - token.length,
    end: caret,
  };
}

/** A row the menu offers: an app command, a harness catalog entry, or a file. */
export type MenuItem =
  | { type: 'command'; command: SlashCommand }
  | { type: 'catalog'; item: SkillInfo }
  | { type: 'file'; path: string };

/**
 * What the open menu paints, in order. Section and group headings are text (a
 * plugin's group also carries the plugin, for its mark); rows are the only
 * things the keyboard and the pointer land on, and each carries its position
 * among the rows alone so navigation never counts headings.
 */
export type MenuEntry =
  | { kind: 'section'; key: string; text: string }
  | { kind: 'group'; key: string; text: string; plugin: SkillInfo | null }
  | { kind: 'row'; key: string; index: number; item: MenuItem };

export interface ComposerMenu {
  entries: MenuEntry[];
  rows: MenuItem[];
}

/**
 * Stable across catalog updates, so a row that lands while the menu is open
 * neither moves the highlight nor remounts a row that is already painted.
 */
export function menuRowKey(item: MenuItem): string {
  if (item.type === 'command') return `command:${item.command.cmd}`;
  if (item.type === 'file') return `file:${item.path}`;
  return `catalog:${catalogRowKey(item.item)}`;
}

const LOCATION_SCOPE = { project: 'repo', personal: 'user', builtin: 'system' } as const;

/** What a row calls itself: an app names itself for people, a skill by its name. */
export function catalogLabel(item: SkillInfo): string {
  return item.displayName ?? item.name;
}

/** Where a row comes from: `repo`, `user`, `system`, or the plugin that owns it. */
export function rowScope(item: SkillInfo): string {
  return item.scope ?? LOCATION_SCOPE[item.location];
}

// The scopes every harness shares, in the order the menu reads them. Any other
// scope is a plugin's name, and those rows group under the plugin instead.
const SHARED_SCOPES = ['repo', 'user', 'system'];

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

interface GroupHeading {
  text: string;
  plugin: SkillInfo | null;
}

interface Group {
  /** Absent for the shared scopes, which read under the section label alone. */
  heading?: GroupHeading;
  rows: MenuItem[];
  rank: number;
}

interface Section {
  label: string;
  groups: Group[];
  rank: number;
}

// Commands match on their name alone, as they always have; skills, apps and
// plugins, whose names are terse, are also reachable through their description.
function rankCommands(query: string, commands: SlashCommand[]): MenuItem[] {
  return rankMenuCandidates(query, commands, (c) => ({ name: c.cmd.slice(1) }))
    .items.slice(0, CATALOG_LIMIT)
    .map((command) => ({ type: 'command', command }));
}

function rankHarnessCommands(query: string, catalog: SkillInfo[]): MenuItem[] {
  const commands = offerable(catalog, 'command');
  return catalogRows(
    rankMenuCandidates(query, commands, (item) => ({ name: item.name })).items.slice(
      0,
      CATALOG_LIMIT,
    ),
  );
}

// A row a prompt cannot invoke is not offered; the catalog still carries it, so
// a plugin can name the group its skills belong to.
function isInvocable(item: SkillInfo): boolean {
  return item.userInvocable !== false && item.enabled !== false;
}

function offerable(catalog: SkillInfo[], kind: SkillInfo['kind']): SkillInfo[] {
  return catalog.filter((item) => item.kind === kind && isInvocable(item));
}

function rankCatalog(query: string, items: SkillInfo[]): SkillInfo[] {
  return rankMenuCandidates(query, items, (item) => ({
    name: item.name,
    description: item.description,
  })).items.slice(0, CATALOG_LIMIT);
}

function catalogRows(items: SkillInfo[]): MenuItem[] {
  return items.map((item) => ({ type: 'catalog', item }));
}

// Rank of the best row in a list. Ranked lists are already sorted, so the first
// row carries it; an empty list stays out of the way.
function bestRank(query: string, rows: MenuItem[]): number {
  const first = rows.at(0);
  if (!first) return Number.POSITIVE_INFINITY;
  if (first.type === 'file') return fileRank(query, first.path);
  if (first.type === 'command') return menuMatchRank(query, { name: first.command.cmd.slice(1) });
  return menuMatchRank(query, { name: first.item.name, description: first.item.description });
}

// Files rank on their name the way catalog rows do, so `@` can lead with an app
// named exactly for the query and otherwise keeps files first.
function fileRank(query: string, path: string): number {
  const rank = menuMatchRank(query, { name: basename(path) });
  return Number.isFinite(rank) ? rank : PATH_ONLY_RANK;
}

function group(rows: MenuItem[], query: string, heading?: GroupHeading): Group {
  return { ...(heading === undefined ? {} : { heading }), rows, rank: bestRank(query, rows) };
}

function section(label: string, groups: Group[], query: string): Section[] {
  const filled = orderByRank(
    query,
    groups.filter((g) => g.rows.length > 0),
  );
  if (filled.length === 0) return [];
  return [{ label, groups: filled, rank: Math.min(...filled.map((g) => g.rank)) }];
}

// A query re-orders sections and groups so the best match leads the whole menu;
// without one the canonical order stands. The sort is stable, so ties keep it.
function orderByRank<T extends { rank: number }>(query: string, items: T[]): T[] {
  if (query.trim() === '') return items;
  return [...items].sort((a, b) => a.rank - b.rank);
}

/**
 * Skills read by where they come from: the scopes every harness shares first,
 * then one sub-labelled group per plugin. Claude's user skills, Codex's repo
 * skills and Droid's own land in the shared groups; a plugin's skills stay
 * together under the plugin's display name.
 */
function skillGroups(query: string, catalog: SkillInfo[]): Group[] {
  const ranked = rankCatalog(query, offerable(catalog, 'skill'));
  const shared = SHARED_SCOPES.map((scope) =>
    group(catalogRows(ranked.filter((item) => rowScope(item) === scope)), query),
  );
  const plugins = new Map<string, SkillInfo[]>();
  for (const item of ranked) {
    const scope = rowScope(item);
    if (SHARED_SCOPES.includes(scope)) continue;
    plugins.set(scope, [...(plugins.get(scope) ?? []), item]);
  }
  const byPlugin = [...plugins]
    .map(([scope, items]) => group(catalogRows(items), query, pluginHeading(scope, catalog)))
    .sort((a, b) => (a.heading?.text ?? '').localeCompare(b.heading?.text ?? ''));
  return [...shared, ...byPlugin];
}

// A plugin's own display name and mark when the catalog carries the plugin
// itself, otherwise the name its skills were tagged with.
function pluginHeading(scope: string, catalog: SkillInfo[]): GroupHeading {
  const plugin = catalog.find((item) => item.kind === 'plugin' && item.name === scope) ?? null;
  return { text: plugin?.displayName ?? scope, plugin };
}

function flatten(sections: Section[]): ComposerMenu {
  const entries: MenuEntry[] = [];
  const rows: MenuItem[] = [];
  for (const s of sections) {
    entries.push({ kind: 'section', key: `section:${s.label}`, text: s.label });
    for (const g of s.groups) {
      if (g.heading !== undefined) {
        entries.push({
          kind: 'group',
          key: `group:${s.label}:${g.heading.text}`,
          text: g.heading.text,
          plugin: g.heading.plugin,
        });
      }
      for (const item of g.rows) {
        entries.push({ kind: 'row', key: menuRowKey(item), index: rows.length, item });
        rows.push(item);
      }
    }
  }
  return { entries, rows };
}

export interface ComposerMenuSources {
  /** DROIDEX's own client-run commands, already filtered to the bound harness. */
  commands: SlashCommand[];
  /** The bound harness's catalog, as far as it has landed. */
  catalog: SkillInfo[];
  files: string[];
}

/**
 * The menu for what has been typed so far. An empty result closes the menu, so a
 * query that matches nothing gets out of the way.
 */
export function composerMenu(
  trigger: ComposerTrigger,
  { commands, catalog, files }: ComposerMenuSources,
): ComposerMenu {
  const { query } = trigger;
  if (trigger.kind === 'file') return flatten(mentionSections(query, catalog, files));
  const named = exactlyNamed(query, commands, catalog);
  return flatten(slashSections(query, named.commands, named.catalog));
}

function isNamed(name: string, query: string): boolean {
  return name.toLowerCase() === query.toLowerCase();
}

// A `/name` typed out in full narrows the menu to the rows it names, so the
// fuzzy matches around it stop competing once the writer knows what they want.
function exactlyNamed(
  query: string,
  commands: SlashCommand[],
  catalog: SkillInfo[],
): { commands: SlashCommand[]; catalog: SkillInfo[] } {
  const namedCommands = commands.filter((c) => isNamed(c.cmd.slice(1), query));
  const namedCatalog = catalog.filter(
    (item) =>
      (item.kind === 'skill' || item.kind === 'command') &&
      isInvocable(item) &&
      isNamed(item.name, query),
  );
  if (namedCommands.length === 0 && namedCatalog.length === 0) return { commands, catalog };
  // Plugins stay so a named plugin skill still groups under its plugin's name.
  const plugins = catalog.filter((item) => item.kind === 'plugin');
  return { commands: namedCommands, catalog: [...namedCatalog, ...plugins] };
}

/**
 * The chip a space turns a fully typed `/name` into: the one skill it names, or
 * the Visualize command, which stages a chip too. Other commands keep the space
 * as text, since what follows them is their argument.
 */
export function chipNamedBy(trigger: ComposerTrigger, menu: ComposerMenu): MenuItem | null {
  if (trigger.kind !== 'slash' || menu.rows.length !== 1) return null;
  const row = menu.rows[0];
  if (row.type === 'catalog' && row.item.kind === 'skill') {
    return isNamed(row.item.name, trigger.query) ? row : null;
  }
  if (row.type === 'command' && row.command.cmd === VISUALIZE_COMMAND.cmd) {
    return isNamed(row.command.cmd.slice(1), trigger.query) ? row : null;
  }
  return null;
}

function slashSections(query: string, commands: SlashCommand[], catalog: SkillInfo[]): Section[] {
  return orderByRank(query, [
    ...section(
      'Commands',
      [
        group(rankCommands(query, commands), query),
        group(rankHarnessCommands(query, catalog), query),
      ],
      query,
    ),
    ...section('Skills', skillGroups(query, catalog), query),
  ]);
}

function mentionSections(query: string, catalog: SkillInfo[], files: string[]): Section[] {
  const byKind = (kind: SkillInfo['kind']) =>
    group(catalogRows(rankCatalog(query, offerable(catalog, kind))), query);
  return orderByRank(query, [
    ...section('Files', [group(fileRows(query, files), query)], query),
    ...section('Apps', [byKind('app')], query),
    ...section('Plugins', [byKind('plugin')], query),
  ]);
}

function fileRows(query: string, files: string[]): MenuItem[] {
  const q = query.toLowerCase();
  return files
    .filter((f) => f.toLowerCase().includes(q))
    .sort((a, b) => fileRank(query, a) - fileRank(query, b) || a.length - b.length)
    .slice(0, FILE_LIMIT)
    .map((path) => ({ type: 'file', path }));
}
