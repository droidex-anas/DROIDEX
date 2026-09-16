import type {
  Query,
  SDKMessage,
  SDKSystemMessage,
  SlashCommand,
} from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SkillInfo } from '../catalog.js';

interface ClaudePlugin {
  name: string;
  path: string;
  source?: string;
  version?: string;
}

interface ClaudeCatalogMetadata {
  skills: Set<string>;
  plugins: ClaudePlugin[];
}

export class ClaudeCatalog {
  private readonly listeners = new Set<(items: SkillInfo[]) => void>();
  private readonly initial: Promise<SkillInfo[]>;
  private items: SkillInfo[] = [];
  private metadata?: ClaudeCatalogMetadata;
  private metadataKey = '';
  private refresh?: Promise<void>;
  private closed = false;

  constructor(
    private readonly query: Pick<Query, 'supportedCommands'>,
    ready: Promise<unknown> = Promise.resolve(),
  ) {
    this.initial = ready
      .then(() => this.fetch())
      .then((items) => {
        if (!this.closed) this.items = items;
        return items;
      });
    void this.initial.catch(() => undefined);
  }

  async catalogItems(): Promise<SkillInfo[]> {
    await (this.refresh ?? this.initial);
    return this.items;
  }

  onUpdated(listener: (items: SkillInfo[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  observe(message: SDKMessage): void {
    if (message.type !== 'system') return;
    if (message.subtype === 'init') {
      const metadata = initMetadata(message);
      const key = metadataSignature(metadata);
      if (key === this.metadataKey) return;
      this.metadata = metadata;
      this.metadataKey = key;
      void this.initial.then(
        () => {
          if (!this.closed) this.publish(claudeCatalogItemsFromCached(this.items, metadata));
        },
        () => undefined,
      );
      return;
    }
    if (message.subtype === 'commands_changed') this.refreshCommands();
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  private fetch(): Promise<SkillInfo[]> {
    return this.query
      .supportedCommands()
      .then((commands) => claudeCatalogItems(commands, this.metadata));
  }

  private refreshCommands(): void {
    if (this.closed) return;
    const pending = (this.refresh ?? this.initial)
      .then(async () => {
        if (this.closed) return;
        const items = await this.fetch();
        this.publish(items);
      })
      .catch((error: unknown) => {
        if (!this.closed) console.warn('Claude catalog refresh failed:', error);
      });
    this.refresh = pending;
    void pending.then(() => {
      if (this.refresh === pending) this.refresh = undefined;
    });
  }

  private publish(items: SkillInfo[]): void {
    if (this.closed) return;
    this.items = items;
    for (const listener of this.listeners) listener(items);
  }
}

export function claudeCatalogItems(
  commands: SlashCommand[],
  metadata?: ClaudeCatalogMetadata,
): SkillInfo[] {
  const commandItems = commands.flatMap((command) => commandItem(command, metadata));
  const pluginItems = metadata?.plugins.flatMap(pluginItem) ?? [];
  return dedupe([...commandItems, ...pluginItems]);
}

function claudeCatalogItemsFromCached(
  current: SkillInfo[],
  metadata: ClaudeCatalogMetadata,
): SkillInfo[] {
  const commands = current
    .filter((item) => item.kind === 'command' || item.kind === 'skill')
    .map((item) => {
      const plugin = pluginForCommand(item.name, metadata.plugins);
      return {
        ...item,
        kind: metadata.skills.has(item.name) ? ('skill' as const) : item.kind,
        ...(plugin ? { scope: pluginScope(plugin, metadata.plugins) } : {}),
      };
    });
  return dedupe([...commands, ...metadata.plugins.flatMap(pluginItem)]);
}

function commandItem(command: SlashCommand, metadata?: ClaudeCatalogMetadata): SkillInfo[] {
  const name = command.name.trim();
  if (!name) return [];
  const prefix = name.includes(':') ? name.slice(0, name.indexOf(':')) : '';
  const pluginName =
    pluginForCommand(name, metadata?.plugins ?? []) ??
    (prefix && command.description.startsWith(`(${prefix})`) ? prefix : undefined);
  const userSkill = command.description.endsWith(' (user)');
  const isSkill = userSkill || metadata?.skills.has(name) === true;
  const description = commandDescription(command.description, pluginName, userSkill);
  return [
    {
      provider: 'claude',
      kind: isSkill ? 'skill' : 'command',
      name,
      description,
      scope: userSkill ? 'user' : (pluginName ?? 'system'),
      ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
      ...(command.aliases?.length ? { aliases: command.aliases } : {}),
      execution: 'harness',
      location: userSkill ? 'personal' : 'builtin',
      filePath: `/${name}`,
      enabled: true,
      userInvocable: true,
    },
  ];
}

function pluginItem(plugin: ClaudePlugin): SkillInfo[] {
  const name = plugin.name.trim();
  const path = plugin.path.trim();
  if (!name || !path) return [];
  const manifest = pluginManifest(path);
  return [
    {
      provider: 'claude',
      kind: 'plugin',
      name,
      description: manifest.description ?? name,
      ...(manifest.displayName ? { displayName: manifest.displayName } : {}),
      scope: plugin.source ?? name,
      execution: 'harness',
      location: 'builtin',
      filePath: path,
      enabled: true,
      userInvocable: false,
      ...(plugin.version ? { version: plugin.version } : {}),
    },
  ];
}

function initMetadata(message: SDKSystemMessage): ClaudeCatalogMetadata {
  const plugins = message.plugins.flatMap((plugin) => {
    const source = (plugin as typeof plugin & { source?: unknown }).source;
    return plugin.name.trim() && plugin.path.trim()
      ? [
          {
            name: plugin.name,
            path: plugin.path,
            ...(typeof source === 'string' && source.trim() ? { source: source.trim() } : {}),
            ...(plugin.version ? { version: plugin.version } : {}),
          },
        ]
      : [];
  });
  return { skills: new Set(message.skills), plugins };
}

function metadataSignature(metadata: ClaudeCatalogMetadata): string {
  return JSON.stringify({ skills: [...metadata.skills].sort(), plugins: metadata.plugins });
}

function pluginForCommand(name: string, plugins: ClaudePlugin[]): string | undefined {
  const prefix = name.includes(':') ? name.slice(0, name.indexOf(':')) : '';
  return prefix && plugins.some((plugin) => plugin.name === prefix) ? prefix : undefined;
}

function pluginScope(name: string, plugins: ClaudePlugin[]): string {
  return plugins.find((plugin) => plugin.name === name)?.source ?? name;
}

function commandDescription(
  description: string,
  plugin: string | undefined,
  user: boolean,
): string {
  let text = description.trim();
  if (user) text = text.replace(/\s+\(user\)$/, '');
  if (plugin) text = text.replace(new RegExp(`^\\(${escapeRegExp(plugin)}\\)\\s*`), '');
  return text;
}

function pluginManifest(path: string): { displayName?: string; description?: string } {
  try {
    const value = JSON.parse(readFileSync(join(path, '.claude-plugin', 'plugin.json'), 'utf8')) as {
      displayName?: unknown;
      description?: unknown;
    };
    const displayName = nonEmptyString(value.displayName);
    const description = nonEmptyString(value.description);
    return {
      ...(displayName ? { displayName } : {}),
      ...(description ? { description } : {}),
    };
  } catch {
    return {};
  }
}

function dedupe(items: SkillInfo[]): SkillInfo[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.filePath}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
