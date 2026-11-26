import type { AvailableCommand } from '@agentclientprotocol/sdk/unstable';
import type { SkillInfo } from '../catalog.js';

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

// Devin advertises built-in slash commands and user skills in one ACP list;
// only its category metadata separates them.
export function devinCatalogItems(commands: readonly AvailableCommand[]): SkillInfo[] {
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
