import { isAbsolute } from 'node:path';

import type { SkillInfo, SkillLocation } from '../catalog.js';
import type { AppServerClient } from './appServer.js';

type CatalogSource = 'skills' | 'plugins' | 'apps';
// Publication order, whichever order the sources answer in.
const SOURCES: readonly CatalogSource[] = ['skills', 'plugins', 'apps'];
// The app listing is a round trip to Codex's connector service: it takes tens
// of seconds and sometimes answers with a server error. Asking once would let
// one bad answer cost the session every app, with nothing to retry it.
const APP_RETRY_DELAY_MS = 1_000;

// Skills answer in milliseconds, installed plugins in a second or two, and the
// first app listing in tens of seconds while Codex discovers its connectors.
// Each source is published as it lands, so nothing waits for the slowest.
export class CodexCatalog {
  private readonly listeners = new Set<(items: SkillInfo[]) => void>();
  private readonly loaded = new Map<CatalogSource, SkillInfo[]>();
  private readonly initial: Promise<void>;
  private refresh?: Promise<void>;
  private closed = false;

  constructor(
    private readonly client: AppServerClient,
    private readonly cwds: string[],
    // How long to wait before asking for the apps again; a test passes zero.
    appRetryDelayMs = APP_RETRY_DELAY_MS,
  ) {
    this.initial = Promise.all([
      this.load('skills', () => loadCodexSkills(client, cwds)),
      this.load('plugins', () => loadCodexPlugins(client, cwds)),
      this.load('apps', () => loadCodexApps(client, appRetryDelayMs)),
    ]).then(() => undefined);
  }

  // The whole catalog: every source settled, plus any skill refresh in flight.
  async catalogItems(): Promise<SkillInfo[]> {
    await (this.refresh ?? this.initial);
    return this.items();
  }

  onUpdated(listener: (items: SkillInfo[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Codex announces `skills/changed`; plugins and apps have no such signal.
  refreshSkills(): void {
    if (this.closed) return;
    const pending = (this.refresh ?? this.initial).then(() =>
      this.load('skills', () => loadCodexSkills(this.client, this.cwds)),
    );
    this.refresh = pending;
    void pending.then(() => {
      if (this.refresh === pending) this.refresh = undefined;
    });
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  private async load(source: CatalogSource, fetch: () => Promise<SkillInfo[]>): Promise<void> {
    try {
      const items = await fetch();
      if (this.closed) return;
      this.loaded.set(source, items);
      for (const listener of this.listeners) listener(this.items());
    } catch (error) {
      // One failed source costs its rows, not the catalog.
      if (!this.closed) console.warn(`Codex catalog (${source}):`, errorMessage(error));
    }
  }

  private items(): SkillInfo[] {
    return SOURCES.flatMap((source) => this.loaded.get(source) ?? []);
  }
}

async function loadCodexSkills(client: AppServerClient, cwds: string[]): Promise<SkillInfo[]> {
  const response = await client.request<unknown>('skills/list', { cwds });
  if (!isRecord(response) || !Array.isArray(response.data))
    throw new Error('Codex returned an invalid skills catalog.');
  return response.data.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.skills))
      throw new Error('Codex returned an invalid skills catalog entry.');
    return entry.skills.map(skillInfo);
  });
}

async function loadCodexPlugins(client: AppServerClient, cwds: string[]): Promise<SkillInfo[]> {
  const response = await client.request<unknown>('plugin/installed', { cwds });
  if (!isRecord(response) || !Array.isArray(response.marketplaces))
    throw new Error('Codex returned an invalid installed-plugin catalog.');
  return response.marketplaces.flatMap((marketplace) => {
    if (!isRecord(marketplace) || !Array.isArray(marketplace.plugins))
      throw new Error('Codex returned an invalid installed-plugin marketplace.');
    const marketplaceName = optionalString(marketplace.name);
    return marketplace.plugins.flatMap((plugin) =>
      isRecord(plugin) && plugin.installed === true && plugin.enabled === true
        ? [pluginInfo(plugin, marketplaceName)]
        : [],
    );
  });
}

async function loadCodexApps(client: AppServerClient, retryDelayMs: number): Promise<SkillInfo[]> {
  try {
    return await listCodexApps(client);
  } catch (error) {
    if (!client.isAlive()) throw error;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return listCodexApps(client);
  }
}

async function listCodexApps(client: AppServerClient): Promise<SkillInfo[]> {
  const items: SkillInfo[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const response: unknown = await client.request<unknown>('app/list', cursor ? { cursor } : {});
    if (!isRecord(response) || !Array.isArray(response.data))
      throw new Error('Codex returned an invalid app catalog.');
    for (const app of response.data) {
      if (isRecord(app) && app.isAccessible === true && app.isEnabled === true)
        items.push(appInfo(app));
    }
    const next: unknown = response.nextCursor;
    if (next === null || next === undefined) return items;
    if (typeof next !== 'string' || !next || seenCursors.has(next))
      throw new Error('Codex returned an invalid app catalog cursor.');
    seenCursors.add(next);
    cursor = next;
  }
}

function skillInfo(value: unknown): SkillInfo {
  if (!isRecord(value)) throw new Error('Codex returned an invalid skill.');
  const name = requiredString(value.name, 'skill name');
  const path = requiredString(value.path, `path for skill ${name}`);
  const scope = skillScope(value.scope);
  const identity = isRecord(value.interface) ? value.interface : undefined;
  const icon = catalogIcon(
    identity?.iconSmallUrl,
    identity?.iconSmall,
    identity?.iconLargeUrl,
    identity?.iconLarge,
  );
  return {
    provider: 'codex',
    kind: 'skill',
    name,
    description:
      optionalString(identity?.shortDescription) ??
      optionalString(value.shortDescription) ??
      (typeof value.description === 'string' ? value.description : ''),
    ...(optionalString(identity?.displayName)
      ? { displayName: optionalString(identity?.displayName) }
      : {}),
    scope: optionalString(value.pluginId)?.split('@')[0] ?? scope,
    ...(icon ? { icon } : {}),
    ...(optionalString(identity?.brandColor)
      ? { brandColor: optionalString(identity?.brandColor) }
      : {}),
    execution: 'harness',
    location: skillLocation(scope),
    filePath: path,
    enabled: value.enabled === true,
    userInvocable: true,
  };
}

function pluginInfo(value: Record<string, unknown>, marketplace?: string): SkillInfo {
  const id = requiredString(value.id, 'plugin id');
  const name = requiredString(value.name, `name for plugin ${id}`);
  const identity = isRecord(value.interface) ? value.interface : undefined;
  const icon = catalogIcon(
    identity?.composerIconUrl,
    identity?.composerIcon,
    identity?.logoUrl,
    identity?.logo,
    identity?.logoUrlDark,
    identity?.logoDark,
  );
  return {
    provider: 'codex',
    kind: 'plugin',
    name,
    description:
      optionalString(identity?.shortDescription) ??
      optionalString(identity?.longDescription) ??
      name,
    ...(optionalString(identity?.displayName)
      ? { displayName: optionalString(identity?.displayName) }
      : {}),
    scope: marketplace ?? 'system',
    ...(icon ? { icon } : {}),
    ...(optionalString(identity?.brandColor)
      ? { brandColor: optionalString(identity?.brandColor) }
      : {}),
    execution: 'harness',
    location: 'builtin',
    filePath: `plugin://${id}`,
    enabled: true,
    userInvocable: true,
    ...(optionalString(value.localVersion ?? value.version)
      ? { version: optionalString(value.localVersion ?? value.version) }
      : {}),
  };
}

function appInfo(value: Record<string, unknown>): SkillInfo {
  const id = requiredString(value.id, 'app id');
  const displayName = requiredString(value.name, `name for app ${id}`);
  const name = appMentionName(displayName);
  const pluginNames = stringArray(value.pluginDisplayNames);
  const icon = appIcon(value);
  return {
    provider: 'codex',
    kind: 'app',
    name,
    description: optionalString(value.description) ?? displayName,
    displayName,
    scope: pluginNames[0] ?? 'system',
    ...(icon ? { icon } : {}),
    execution: 'harness',
    location: 'builtin',
    filePath: `app://${id}`,
    enabled: true,
    userInvocable: true,
  };
}

function appIcon(value: Record<string, unknown>): SkillInfo['icon'] | undefined {
  const assets = isRecord(value.iconAssets) ? value.iconAssets : undefined;
  return catalogIcon(
    normalizeAppUrl(value.logoUrl),
    normalizeAppUrl(value.logoUrlDark),
    normalizeAppUrl(assets?.['256_square']),
    normalizeAppUrl(assets?.['256_circle']),
  );
}

function appMentionName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/^-+|-+$/g, '') || 'app'
  );
}

function normalizeAppUrl(value: unknown): string | undefined {
  const source = optionalString(value);
  if (!source) return undefined;
  if (source.startsWith('/')) return new URL(source, 'https://chatgpt.com').href;
  return source;
}

function catalogIcon(...values: unknown[]): SkillInfo['icon'] | undefined {
  for (const value of values) {
    const source = optionalString(value);
    if (!source) continue;
    if (credentialFreeHttpsUrl(source)) return { url: source };
    if (isAbsolute(source)) return { path: source };
  }
  return undefined;
}

function skillScope(value: unknown): 'user' | 'repo' | 'system' | 'admin' {
  if (value === 'user' || value === 'repo' || value === 'system' || value === 'admin') return value;
  throw new Error('Codex returned an invalid skill scope.');
}

function skillLocation(scope: 'user' | 'repo' | 'system' | 'admin'): SkillLocation {
  if (scope === 'repo') return 'project';
  if (scope === 'user') return 'personal';
  return 'builtin';
}

function credentialFreeHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function requiredString(value: unknown, field: string): string {
  const text = optionalString(value);
  if (!text) throw new Error(`Codex returned an invalid ${field}.`);
  return text;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (optionalString(item) ? [item as string] : []))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A failing source can answer with a whole document — a sign-in challenge page
// once put an HTML body in the log. One line, bounded, is all a warning needs.
const LOG_LINE_LIMIT = 200;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split('\n', 1)[0].trim();
  return firstLine.length > LOG_LINE_LIMIT ? `${firstLine.slice(0, LOG_LINE_LIMIT)}…` : firstLine;
}
