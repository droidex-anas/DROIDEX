from pathlib import Path
import re


def edit(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    assert s.count(old) == count, (path, old, s.count(old), count)
    p.write_text(s.replace(old, new))


path = 'sidecar/src/projects/ProjectService.test.ts'
edit(path, '  let projects: ProjectService;\n', '')
edit(path, '  projects = await ProjectService.open(', '  const projects = await ProjectService.open(')
path = 'sidecar/src/projects/ProjectService.ts'
edit(path, '      threads: project.threads.map(({ reply: _reply, ...thread }) => thread),', '''      threads: project.threads.map((thread) => ({
        appSessionId: thread.appSessionId,
        title: thread.title,
        waiting: thread.waiting,
        ...(thread.ownerAppSessionId ? { ownerAppSessionId: thread.ownerAppSessionId } : {}),
      })),''')
edit(path, '    const session = event.session;\n    const project = this.membership.get(session.appSessionId);', '''    await this.observeSession(event.session);
  }

  private async observeSession(session: SessionSummary): Promise<void> {
    const project = this.membership.get(session.appSessionId);''')

path = 'sidecar/src/projects/bridge.ts'
edit(path, "import type { ClientCommand, ServerEvent } from '../protocol.js';", "import type { ServerEvent } from '../protocol.js';")
edit(path, '): (command: ClientCommand) => Promise<boolean> {', '): (command: unknown) => Promise<boolean> {')
p = Path(path)
s = p.read_text()
start = s.index('    if (\n      !value ||')
end = s.index('    const parsed = commandSchema.safeParse(value);', start)
s = s[:start] + '    if (!isProjectRequest(value)) return false;\n' + s[end:]
s += '''
function isProjectRequest(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') return false;
  return value.type.startsWith('project.') || value.type.startsWith('projects.');
}
'''
p.write_text(s)

path = 'sidecar/src/projects/store.ts'
edit(path, 'this.writing.catch(() => {}).then(', 'this.writing.catch(() => undefined).then(')
edit(path, "await unlink(temporary).catch((error: NodeJS.ErrnoException) => {\n        if (error.code !== 'ENOENT') throw error;\n      });", "await unlink(temporary).catch((error: unknown) => {\n        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;\n      });")
p = Path(path)
s = p.read_text()
start = s.index('    const projectIds = new Set<string>();')
end = s.index('    return projects;', start)
s = s[:start] + '    validateLedger(projects);\n' + s[end:]
s += '''
function validateLedger(projects: Project[]): void {
  const projectIds = new Set<string>();
  const sessionIds = new Set<string>();
  for (const item of projects) {
    if (projectIds.has(item.id)) throw new Error('Duplicate project identity in ledger.');
    projectIds.add(item.id);
    for (const thread of item.threads) {
      if (sessionIds.has(thread.appSessionId)) throw new Error('A thread belongs to multiple projects.');
      sessionIds.add(thread.appSessionId);
    }
    validateOwnership(item);
    validateInbox(item);
  }
}

function validateOwnership(project: Project): void {
  const threads = new Map(project.threads.map((thread) => [thread.appSessionId, thread]));
  const roots = project.threads.filter((thread) => !thread.ownerAppSessionId);
  if (project.threads.length && roots.length !== 1)
    throw new Error('Project ledger must have exactly one main thread.');
  for (const thread of project.threads) {
    let owner = thread.ownerAppSessionId;
    const seen = new Set([thread.appSessionId]);
    while (owner) {
      if (seen.has(owner) || !threads.has(owner)) throw new Error('Invalid project ownership.');
      seen.add(owner);
      owner = threads.get(owner)?.ownerAppSessionId;
    }
  }
}

function validateInbox(project: Project): void {
  const ids = new Set(project.threads.map((thread) => thread.appSessionId));
  const messages = [...project.pending, ...(project.delivery?.messages ?? [])];
  if (messages.length > 64) throw new Error('Project inbox exceeds 64 messages.');
  if (new Set(messages.map((note) => note.id)).size !== messages.length)
    throw new Error('Duplicate message identity in project ledger.');
  if (project.delivery && new Set(project.delivery.messages.map((note) => note.to)).size !== 1)
    throw new Error('A delivery claim must have one recipient.');
  for (const note of messages) {
    if (!ids.has(note.from) || !ids.has(note.to)) throw new Error('Unknown delivery target.');
  }
}
'''
p.write_text(s)

# These tests should follow the protocol's declared version, not duplicate it.
path = 'src/lib/bridge.integration.test.ts'
edit(path, "import type { ServerEvent } from '../types/bridge';", "import { BRIDGE_PROTOCOL_VERSION, type ServerEvent } from '../types/bridge';")
p = Path(path)
s = p.read_text()
s, count = re.subn(r"'([^'\n]*bridgeProtocol=)4'", lambda match: '`' + match[1] + '${BRIDGE_PROTOCOL_VERSION}`', s)
assert count == 3, count
p.write_text(s)
path = 'src/lib/bridgeBatch.integration.test.ts'
p = Path(path)
s = p.read_text()
s = "import { BRIDGE_PROTOCOL_VERSION } from '../types/bridge';\n" + s
s, count = re.subn(r"(searchParams\.get\('bridgeProtocol'\),\s*)'4'", r'\1String(BRIDGE_PROTOCOL_VERSION)', s)
assert count == 1, count
p.write_text(s)
print('Applied runtime-safe projections, small validation helpers, and protocol assertions.')
