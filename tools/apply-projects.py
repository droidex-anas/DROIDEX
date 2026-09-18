from pathlib import Path
import re


def edit(path, old, new, count=1):
    p = Path(path)
    s = p.read_text()
    assert s.count(old) == count, (path, old, s.count(old), count)
    p.write_text(s.replace(old, new))


def prepend(path, text):
    p = Path(path)
    p.write_text(text + p.read_text())


# Keep the existing protocol mirrors as the transport boundary.
for path, source in [('sidecar/src/protocol.ts', './projects/types.js'), ('src/types/bridge.ts', '../../sidecar/src/projects/types')]:
    prepend(path, f"import type {{ ProjectCommand, ProjectEvent }} from '{source}';\n")
    p = Path(path)
    s = p.read_text()
    for name, extension in [('ClientCommand', 'ProjectCommand'), ('ServerEvent', 'ProjectEvent')]:
        s, n = re.subn(r'(export type ' + name + r'\s*=\s*)\|?', r'\1' + extension + ' |', s)
        assert n == 1, (path, name)
    p.write_text(s)

path = 'sidecar/src/SessionLifecycle.ts'
edit(path, 'async create(command: SessionCreateCommand): Promise<void> {', '''async create(
    command: SessionCreateCommand,
    bind?: (session: SessionSummary) => Promise<void>,
  ): Promise<SessionSummary | undefined> {''')
edit(path, "      d.childSessions.attachParent(appSessionId);\n      d.emit({ type: 'session.created', clientRef: command.clientRef, session: summary });", """      d.childSessions.attachParent(appSessionId);
      if (bind) {
        await bind(summary);
        this.requireOpenAdmission();
        if (d.registry.getLive(appSessionId) !== liveSession || liveSession.session.isClosed) {
          throw new Error('The session closed before its first turn.');
        }
      }
      d.emit({ type: 'session.created', clientRef: command.clientRef, session: summary });""")
edit(path, '      this.driveInBackground(appSessionId, sessionPrompt(command.goal, command.mentions));', '      this.driveInBackground(appSessionId, sessionPrompt(command.goal, command.mentions));\n      return summary;')
edit(path, '  async send(\n', '''  // Admit a watcher turn only after resume/settings have settled. Unlike send(),
  // this must never join the user's pending queue or interrupt their active turn.
  async sendWhenIdle(appSessionId: string, text: string, isCurrent: () => boolean): Promise<boolean> {
    const d = this.dependencies;
    if (!isCurrent() || d.isShutdownStarted()) return false;
    const current = d.registry.getLive(appSessionId);
    if (current && !this.acceptsWake(current)) return false;
    const live = await this.prepareToSend(appSessionId);
    if (!live || !isCurrent() || d.isShutdownStarted() ||
        d.registry.getLive(live.summary.appSessionId) !== live || !this.acceptsWake(live)) return false;
    this.driveInBackground(live.summary.appSessionId, sessionPrompt(text));
    return true;
  }

  private acceptsWake(live: LiveSession): boolean {
    return !live.streaming && !live.compacting && !live.autoCompacting &&
      !live.pendingSends.length && !live.closeMode && !live.interrupting &&
      !live.interruptingForSteer && !live.session.isClosed &&
      !live.summary.phase.startsWith('awaiting_');
  }

  async send(
''')

path = 'sidecar/src/SessionManager.ts'
prepend(path, "import type { ProjectSessions } from './projects/Projects.js';\n")
p = Path(path)
s = p.read_text()
pattern = r'(interface SessionManagerOptions\s*\{)'
s, n = re.subn(pattern, r'\1\n  createProjectMcpResource?: (appSessionId: () => string) => StartedLocalMcpResources["servers"][number] & { start(): Promise<StartedLocalMcpResources["configs"][number]> };', s)
assert n == 1, 'SessionManagerOptions'
p.write_text(s)
edit(path, '  private readonly createLocalMcpResource:', "  private readonly createProjectMcpResource: SessionManagerOptions['createProjectMcpResource'];\n  private readonly createLocalMcpResource:")
edit(path, '    this.providerProbes = new ProviderProbes(', '    this.createProjectMcpResource = options.createProjectMcpResource;\n    this.providerProbes = new ProviderProbes(')
edit(path, '    const servers = [this.createLocalMcpResource(() => ref.id)];', '    const servers = [this.createLocalMcpResource(() => ref.id)];\n    if (this.createProjectMcpResource) servers.push(this.createProjectMcpResource(() => ref.id));')
edit(path, '  async automationSessionContext(', '''  projectSessions(): ProjectSessions {
    return {
      get: (id) => this.registry.getLive(id)?.summary ?? this.registry.resolveSummary(id),
      create: (input, bind) => {
        const { prompt, ...settings } = input;
        const status = this.projectCatalog().find((item) => item.provider === input.provider);
        const model = status?.models.find((item) => item.id === input.modelId);
        if (input.reasoningEffort && model?.supportedReasoningEfforts?.length &&
            !model.supportedReasoningEfforts.includes(input.reasoningEffort)) {
          throw new Error(`${model.displayName} does not support ${input.reasoningEffort} reasoning.`);
        }
        return this.lifecycle.create({
          ...settings, type: 'session.create', clientRef: `project:${randomUUID()}`,
          goal: prompt, sessionPurpose: 'chat', interactionMode: 'auto',
        }, bind);
      },
      sendWhenIdle: (id, prompt, isCurrent) => this.lifecycle.sendWhenIdle(id, prompt, isCurrent),
      interrupt: (id) => this.lifecycle.interrupt(id),
    };
  }

  projectCatalog(): ProviderStatus[] {
    return providerStatuses(this.runtime.status().droidPath, this.cachedModels ?? [],
      this.cachedModels?.find((model) => model.isDefault)?.id,
      (provider) => this.providerProbes.status(provider));
  }

  async automationSessionContext(''')
if not re.search(r'\bProviderStatus\s*[,}]', Path(path).read_text().split('export class SessionManager')[0]):
    prepend(path, "import type { ProviderStatus } from './protocol.js';\n")

path = 'sidecar/src/index.ts'
prepend(path, """import { join } from 'node:path';
import { Projects } from './projects/Projects.js';
import { ProjectStore } from './projects/projectStore.js';
import { createProjectMcpServer } from './projects/projectMcpServer.js';
import { createProjectCommandHandler } from './projects/projectCommands.js';
import { droidexHistoryDir } from './droidexPaths.js';
""")
edit(path, 'let automationManager: AutomationManager | null = null;', 'let automationManager: AutomationManager | null = null;\nlet projects: Projects | undefined;')
edit(path, '  onCommand: async (command) => {', '  onCommand: async (command) => {\n    if (await handleProjectCommand(command)) return;')
edit(path, '  (event) => {\n    if (automationManager)', "  (event) => {\n    if (projects) void projects.observe(event).catch((error: unknown) => console.error('Project observer failed', error));\n    if (automationManager)")
edit(path, '    assetUrlFor: (filePath) => server.browserAssetUrl(filePath),', '    assetUrlFor: (filePath) => server.browserAssetUrl(filePath),\n    createProjectMcpResource: (id) => createProjectMcpServer(() => projectsReady, id, () => manager.projectCatalog()),')
edit(path, 'automationManager = configureAutomationManager({', """const projectsReady = Projects.open(manager.projectSessions(),
  new ProjectStore(join(droidexHistoryDir(), 'projects.json')), (event) => server.broadcast(event),
).then((owner) => {
  projects = owner;
  if (shuttingDown) owner.close();
  return owner;
});
void projectsReady.catch((error: unknown) => server.broadcast({
  type: 'error', code: 'project.load_failed',
  message: error instanceof Error ? error.message : String(error),
}));
const handleProjectCommand = createProjectCommandHandler(projectsReady, (event) => server.broadcast(event));

automationManager = configureAutomationManager({""")
edit(path, '  shuttingDown = true;', '  shuttingDown = true;\n  projects?.close();')
edit(path, '        await automationManager?.shutdown();', '        await automationManager?.shutdown();\n        await projects?.flush();')

# Codex gets the same runtime-owned endpoints on create and resume.
path = 'sidecar/src/providers/codex/CodexProvider.ts'
edit(path, '    autonomyLevel,\n  }: ProviderOpenInput)', '    autonomyLevel,\n    mcpServers,\n  }: ProviderOpenInput)')
edit(path, '      appSessionId: randomUUID(),', '      appSessionId: randomUUID(),\n      mcpServers,')
edit(path, '{ interactions, cwd, modelId, reasoningEffort, autonomy, resumeId }: ProviderResumeInput', '{ interactions, cwd, modelId, reasoningEffort, autonomy, resumeId, mcpServers }: ProviderResumeInput')
edit(path, '        appSessionId: providerSessionId,', '        appSessionId: providerSessionId,\n        mcpServers,')
path = 'sidecar/src/providers/codex/codexSession.ts'
prepend(path, "import type { McpServerConfig } from '@factory/droid-sdk';\nimport { codexMcpConfig } from './codexMcp.js';\n")
edit(path, 'export interface CodexSessionInput {', 'export interface CodexSessionInput {\n  mcpServers?: McpServerConfig[];')
edit(path, '  private readonly cwd: string;', '  private readonly cwd: string;\n  private readonly mcpConfig: Record<string, unknown>;')
edit(path, '    this.cwd = input.cwd;', '    this.cwd = input.cwd;\n    this.mcpConfig = codexMcpConfig(input.mcpServers);')
edit(path, '    const settings = {\n      cwd: this.cwd,', '    const settings = {\n      ...(Object.keys(this.mcpConfig).length ? { config: this.mcpConfig } : {}),\n      cwd: this.cwd,')

# Ownership and scheduling stay separate, with cancellation observed after IO.
path = 'sidecar/src/projects/Projects.ts'
prepend(path, "import { ProjectWakeQueue } from './ProjectWakeQueue.js';\n")
p = Path(path)
s = p.read_text()
start = s.index('  private readonly generations = ')
end = s.index('  private closed = false;', start)
s = s[:start] + '  private readonly wakes: ProjectWakeQueue;\n' + s[end:]
s = s.replace('  ) {}', '  ) {\n    this.wakes = new ProjectWakeQueue(sessions, () => this.save(), (project, error) => this.fail(project, error));\n  }', 1)
start = s.index('  private kick(project: Project): void {')
end = s.index('  private enqueue(', start)
s = s[:start] + s[end:]
start = s.index('  private invalidate(project: Project): void {')
end = s.index('  private fail(', start)
s = s[:start] + s[end:]
s = s.replace('this.kick(project)', 'this.wakes.kick(project)').replace('this.invalidate(project)', 'this.wakes.invalidate(project)')
s = s.replace('    await Promise.all(this.pumping.values());', '    await this.wakes.flush();')
s = s.replace('    for (const project of this.projects.values()) this.wakes.invalidate(project);', '    this.wakes.close();')
s = s.replace("    const generation = this.generations.get(project.id);\n    const isCurrent = () => !this.closed && !project.paused && this.generations.get(project.id) === generation;", '    const isCurrent = this.wakes.guard(project);')
s = s.replace('    project.pending = project.pending.filter((message) => message.to !== target);', '    await this.wakes.settle(project);\n    project.pending = project.pending.filter((message) => message.to !== target);')
s = s.replace('    if (reply === undefined) return;', '    if (reply === undefined) { this.wakes.kick(project); return; }')
s = s.replace('    thread.reply = reply;', "    thread.reply = reply;\n    if (!thread.ownerAppSessionId && session.phase === 'failed') this.fail(project, new Error('The main thread failed. Review its error before resuming coordination.'));")
s = s.replace('        bound = created.appSessionId;', "        if (this.membership.has(created.appSessionId)) throw new Error('The harness reused an existing thread identity.');\n        bound = created.appSessionId;")
s = s.replace('async create(input: ThreadInput): Promise<string>', 'async create(input: ThreadInput, requestId?: string): Promise<string>')
s = s.replace('    const project = this.newProject(input.title);', '    if (requestId && this.projects.has(requestId)) return requestId;\n    const project = this.newProject(input.title, requestId);')
s = s.replace('      this.fail(project, error);\n      throw error;', '      this.fail(project, error);\n      if (!project.threads.length) { this.projects.delete(project.id); await this.save(); }\n      throw error;', 1)
s = s.replace('private newProject(title: string): Project', 'private newProject(title: string, id = randomUUID()): Project')
s = s.replace('const project: Project = { id: randomUUID(), title:', 'const project: Project = { id, title:')
p.write_text(s)
edit('sidecar/src/projects/projectCommands.ts', 'await projects.create(input.input)', 'await projects.create(input.input, input.requestId)')

# The UI route reuses normal session activation, history, chat and composer.
path = 'src/hooks/useStore.tsx'
p = Path(path)
s = p.read_text()
match = re.search(r'(?:export )?function (\w+)\(\s*state: (?:State|AppState),\s*action: Action', s)
if not match:
    match = re.search(r'(?:export )?function (\w+)\([^)]*action: Action[^)]*\)', s)
assert match, 'Find store reducer function'
reducer = match[1]
p.write_text(s)
edit(path, "  | { type: 'OPEN_AUTOMATIONS'; automationId?: string }", "  | { type: 'OPEN_PROJECTS'; appSessionId?: string }\n  | { type: 'CLOSE_PROJECTS' }\n  | { type: 'OPEN_AUTOMATIONS'; automationId?: string }")
edit(path, "    case 'SET_ACTIVE_SESSION': {", f"""    case 'OPEN_PROJECTS': {{
      const next = action.appSessionId
        ? {reducer}(state, {{ type: 'SET_ACTIVE_SESSION', id: action.appSessionId }})
        : state;
      return {{ ...next, mainView: 'projects', selectedChild: null }};
    }}
    case 'CLOSE_PROJECTS':
      return {{ ...state, mainView: 'session' }};

    case 'SET_ACTIVE_SESSION': {{""")
path = 'src/hooks/persistedUiPreferences.ts'
edit(path, "export type MainView = 'session' | 'pull-requests' | 'automations';", "export type MainView = 'session' | 'pull-requests' | 'automations' | 'projects';")
p = Path(path)
s = p.read_text()
s, n = re.subn(r"(\w+\.mainView) === 'automations'", r"(\1 === 'automations' || \1 === 'projects')", s)
p.write_text(s)
print('Updated persisted route cases:', n)
path = 'src/lib/lazySurfaces.tsx'
edit(path, 'export const LAZY_SURFACE_LOADERS = {', "export const LAZY_SURFACE_LOADERS = {\n  projects: () => import('../features/projects/ProjectsRoute'),")
edit(path, 'export const LazyAutomationsRoute =', 'export const LazyProjectsRoute = lazy(LAZY_SURFACE_LOADERS.projects);\nexport const LazyAutomationsRoute =')
path = 'src/App.tsx'
edit(path, '  LazyAutomationsRoute,', '  LazyAutomationsRoute,\n  LazyProjectsRoute,')
edit(path, "    if (state.mainView === 'automations') {", "    if (state.mainView === 'projects') {\n      dispatch({ type: 'CLOSE_PROJECTS' });\n    } else if (state.mainView === 'automations') {")
edit(path, "(state.mainView === 'pull-requests' || state.mainView === 'automations');", "(state.mainView === 'pull-requests' || state.mainView === 'automations' || state.mainView === 'projects');")
edit(path, '              ) : isMissionControlView ? (', '''              ) : !embedded && state.mainView === 'projects' ? (
                <Suspense fallback={<PanelSkeleton title="projects" />}>
                  <LazyProjectsRoute />
                </Suspense>
              ) : isMissionControlView ? (''')
path = 'src/components/SidebarNavigation.tsx'
prepend(path, "import { GitBranch } from 'lucide-react';\n")
edit(path, '  const automationsButtonRef =', '  const projectsButtonRef = useRef<HTMLButtonElement>(null);\n  const automationsButtonRef =')
edit(path, "  useEffect(() => bindLazySurfaceIntent('automations', automationsButtonRef.current), []);", "  useEffect(() => bindLazySurfaceIntent('automations', automationsButtonRef.current), []);\n  useEffect(() => bindLazySurfaceIntent('projects', projectsButtonRef.current), []);")
edit(path, '    <>\n', '''    <>
      <button ref={projectsButtonRef} data-testid="projects-nav"
        onClick={() => dispatch({ type: 'OPEN_PROJECTS' })}
        aria-current={state.mainView === 'projects' ? 'page' : undefined}
        className={`group mt-0.5 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] font-medium transition-colors ${state.mainView === 'projects' ? 'bg-droid-active text-droid-text' : 'text-droid-text hover:bg-droid-elevated'}`}>
        <GitBranch className="h-3.5 w-3.5 shrink-0 text-droid-text-secondary" />
        Projects
      </button>
''')
path = 'src/lib/bridgeWireValidation.ts'
prepend(path, "import { isProjectView } from '../../sidecar/src/projects/types';\n")
edit(path, "    case 'connection':", """    case 'projects.snapshot':
      return Array.isArray(value.projects) && value.projects.length <= 32 && value.projects.every(isProjectView);
    case 'project.result':
      return typeof value.requestId === 'string' &&
        (value.error !== undefined ? typeof value.error === 'string' : typeof value.projectId === 'string');
    case 'connection':""")
path = 'src/features/projects/ProjectsRoute.tsx'
edit(path, "useState<'list' | 'new' | string>('list')", "useState('list')")
edit(path, '      <header className=', '      <div data-electron-drag-region className="h-9 shrink-0" />\n      <header className=')
path = 'src/features/projects/NewProject.tsx'
edit(path, "import { useState, type FormEvent } from 'react';", "import { useEffect, useState, type FormEvent } from 'react';\nimport { refreshProviders } from '../../lib/commands';")
edit(path, '  const statuses = useStoreSelector', '  useEffect(() => { refreshProviders(); }, []);\n  const statuses = useStoreSelector')
print('Projects integration applied.')
