import type { AvailableCommand } from '@agentclientprotocol/sdk/unstable';
import type { SkillInfo } from '@droidex/protocol';

// DROIDEX owns the overlapping mode, model, feedback, and title controls, so
// offering these through text would change Devin behind those controls' backs.
const CLIENT_OWNED_COMMANDS = new Set([
  'ask',
  'plan',
  'code',
  'smart',
  'bypass',
  'fast',
  'bug',
  'btw',
  'rename',
]);

// Devin pushes its command list on every session load and whenever it changes.
export class DevinCatalog {
  private items: SkillInfo[] = [];
  private readonly listeners = new Set<(items: SkillInfo[]) => void>();

  catalogItems(): Promise<SkillInfo[]> {
    return Promise.resolve(this.items);
  }

  onCatalogUpdated(listener: (items: SkillInfo[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  update(commands: readonly AvailableCommand[]): void {
    this.items = devinCatalogItems(commands);
    for (const listener of this.listeners) listener(this.items);
  }
}

// Devin advertises built-in slash commands and user skills in one ACP list;
// only its category metadata separates them.
function devinCatalogItems(commands: readonly AvailableCommand[]): SkillInfo[] {
  return commands.flatMap((command) => {
    const name = command.name.trim();
    if (!name) return [];
    const skill = command._meta?.['cognition.ai/category'] === 'Skills';
    if (!skill && CLIENT_OWNED_COMMANDS.has(name.toLowerCase())) return [];
    return [
      {
        provider: 'devin' as const,
        kind: skill ? ('skill' as const) : ('command' as const),
        name,
        description: command.description,
        scope: skill ? 'user' : 'system',
        ...(command.input?.hint ? { argumentHint: command.input.hint } : {}),
        execution: 'harness' as const,
        location: skill ? ('personal' as const) : ('builtin' as const),
        filePath: `devin://${skill ? 'skill' : 'command'}/${name}`,
        enabled: true,
        userInvocable: true,
      },
    ];
  });
}
