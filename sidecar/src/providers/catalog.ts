import type { SkillLocation, SkillInfo } from '@droidex/protocol';
import { isAbsolute } from 'node:path';

export function droidCatalogItems(values: unknown[]): SkillInfo[] {
  return values.map((value) => {
    if (!isRecord(value)) throw new Error('Droid returned an invalid skill catalog entry.');
    const name = requiredString(value.name, 'name');
    const filePath = requiredString(value.filePath, `path for ${name}`);
    const location = skillLocation(value.location);
    return {
      provider: 'droid',
      kind: 'skill',
      name,
      description: typeof value.description === 'string' ? value.description : '',
      scope: { project: 'repo', personal: 'user', builtin: 'system' }[location],
      execution: 'harness',
      location,
      filePath,
      ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}),
      ...(typeof value.userInvocable === 'boolean' ? { userInvocable: value.userInvocable } : {}),
      ...(typeof value.version === 'string' ? { version: value.version } : {}),
    };
  });
}

function skillLocation(value: unknown): SkillLocation {
  if (value === 'project' || value === 'personal' || value === 'builtin') return value;
  throw new Error('Droid returned an invalid skill location.');
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Droid returned a skill without a valid ${field}.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The commands that carry a prompt, and so may carry the rows staged with it.
const MENTION_COMMANDS = new Set(['session.send', 'session.create', 'browser.design.sendPrompt']);

export function assertValidMentions(command: object & { mentions?: unknown }): void {
  if (
    !('type' in command) ||
    !MENTION_COMMANDS.has(String(command.type)) ||
    !Array.isArray(command.mentions)
  )
    throw new Error('Mentions are only valid on a session or design prompt.');
  for (const mention of command.mentions) {
    if (
      !isRecord(mention) ||
      (mention.kind !== 'skill' && mention.kind !== 'app' && mention.kind !== 'plugin') ||
      typeof mention.name !== 'string' ||
      !mention.name.trim() ||
      (mention.path !== undefined && typeof mention.path !== 'string')
    )
      throw new Error('Invalid provider mention.');
    const path = mention.path;
    if (path === undefined) continue;
    if (mention.kind === 'skill' && !isAbsolute(path))
      throw new Error('Skill mentions require an absolute path.');
    if (
      mention.kind !== 'skill' &&
      (!path.startsWith(`${mention.kind}://`) || path === `${mention.kind}://`)
    )
      throw new Error('App and plugin mentions require their catalog invocation path.');
  }
}
