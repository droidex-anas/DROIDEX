import type { ProviderKind, ProviderMention, ProviderStatus, SkillInfo } from '../../types/bridge';

const NO_ROWS: SkillInfo[] = [];

/**
 * What the composer's menus read for the harness this chat is bound to: a live
 * chat takes the catalog its own session published, a draft takes the rows
 * already riding on the provider's probe status.
 *
 * Both are state the renderer already holds, so opening a menu asks the sidecar
 * for nothing. Each harness publishes its sources as they land — Codex's skills
 * within moments, its plugins and apps later — and a source that has not landed
 * is absent rather than empty.
 */
export function composerCatalog({
  provider,
  providerSessionId,
  skills,
  skillsProviderSessionId,
  providerStatuses,
}: {
  provider: ProviderKind;
  providerSessionId: string | null;
  skills: SkillInfo[];
  skillsProviderSessionId: string | null | undefined;
  providerStatuses: ProviderStatus[];
}): SkillInfo[] {
  // The published catalog belongs to one session at a time, and a draft shares
  // the null id with whatever was published for a draft before it, so the rows
  // still have to name this harness.
  const published = skillsProviderSessionId === providerSessionId;
  const live = published ? skills.filter((row) => row.provider === provider) : NO_ROWS;
  // Once a live session has published, its catalog is the answer, even when it
  // is empty: the probe listed another working directory. Until then the probe's
  // rows stand in, so a chat that just opened does not show an empty menu.
  if (live.length > 0 || (published && providerSessionId !== null)) return live;
  return providerStatuses.find((status) => status.provider === provider)?.items ?? NO_ROWS;
}

/** A row's identity: two harness rows can share a name, never a kind and path. */
export function catalogRowKey(row: SkillInfo): string {
  return `${row.kind}:${row.filePath}`;
}

// Only Codex's turn protocol carries catalog items beside the prompt. The other
// harnesses read the composed text, so their staged rows stay in it.
const MENTION_PROVIDERS = new Set<ProviderKind>(['codex']);

/**
 * How a staged row reaches the harness: as a structured mention where the
 * protocol has one, otherwise as part of the prompt text. A row whose catalog
 * path cannot be invoked stays in the text rather than failing the send.
 */
function mentionForRow(provider: ProviderKind, row: SkillInfo): ProviderMention | null {
  if (!MENTION_PROVIDERS.has(provider) || row.kind === 'command') return null;
  // The sidecar rejects a mention whose path the harness cannot resolve: an
  // absolute file for a skill, the catalog's own scheme for an app or plugin.
  if (row.kind === 'skill') {
    return row.filePath.startsWith('/')
      ? { kind: 'skill', name: row.name, path: row.filePath }
      : null;
  }
  const prefix = `${row.kind}://`;
  return row.filePath.startsWith(prefix) && row.filePath.length > prefix.length
    ? { kind: row.kind, name: row.name, path: row.filePath }
    : null;
}

export function mentionsForRows(provider: ProviderKind, rows: SkillInfo[]): ProviderMention[] {
  return rows.flatMap((row) => {
    const mention = mentionForRow(provider, row);
    return mention ? [mention] : [];
  });
}
