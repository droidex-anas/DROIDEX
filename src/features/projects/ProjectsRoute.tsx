import { useState } from 'react';
import { MessageCirclePlus, Plus, RefreshCw } from 'lucide-react';
import ChatView from '../../components/ChatView';
import PromptInput from '../../components/PromptInput';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { createProject, pauseProject, refreshProjects, spawnThread, stopThread, useProjects } from './client';
import { NewThreadForm } from './NewThreadForm';
import { ProjectThreadCard } from './ProjectThreadCard';
import type { ThreadInput } from './types';

export function ProjectsRoute() {
  const snapshot = useProjects();
  const dispatch = useStoreDispatch();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openedThread, setOpenedThread] = useState<string | null>(null);
  const [form, setForm] = useState<{ ownerId?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const owner = useStoreSelector((state) => form?.ownerId ? state.sessions[form.ownerId] : undefined);
  const cwd = useStoreSelector((state) => state.activeAppSessionId ? state.sessions[state.activeAppSessionId]?.cwd ?? '' : '');
  const project = snapshot.projects.find((item) => item.id === selectedId) ?? snapshot.projects[0];
  const root = project?.threads.find((thread) => !thread.ownerAppSessionId);
  const active = project?.threads.find((thread) => thread.appSessionId === openedThread);

  function openThread(appSessionId: string): void {
    setForm(null);
    setOpenedThread(appSessionId);
    dispatch({ type: 'OPEN_PROJECTS', appSessionId });
  }

  async function submit(input: ThreadInput): Promise<void> {
    if (form?.ownerId) {
      const { cwd: _cwd, ...selection } = input;
      const id = await spawnThread(form.ownerId, selection);
      openThread(id);
    } else {
      const id = await createProject(input);
      setSelectedId(id);
      setOpenedThread(null);
      setForm(null);
    }
  }

  async function togglePaused(): Promise<void> {
    if (!project || pending) return;
    setPending(true);
    setError('');
    try {
      await pauseProject(project.id, !project.paused, reviewed);
      setReviewed(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  }

  return <div className="flex h-full min-h-0 flex-col bg-droid-bg text-droid-text">
    <div data-electron-drag-region className="h-9 shrink-0" />
    <div className="flex min-h-0 flex-1">
      <aside aria-label="Projects" className="w-[236px] shrink-0 overflow-auto border-r border-droid-border/60 px-3 py-3">
        <div className="mb-3 flex items-center justify-between px-2">
          <span className="text-[11px] font-medium text-droid-text-muted">Projects</span>
          <button type="button" aria-label="New project" onClick={() => { setForm({}); setOpenedThread(null); setError(''); }} className="rounded-lg p-1.5 text-droid-text-secondary hover:bg-droid-elevated focus-visible:ring-2 focus-visible:ring-droid-text-muted"><Plus size={14} /></button>
        </div>
        <div className="space-y-1">{snapshot.projects.map((item) => <button type="button" key={item.id} onClick={() => { setSelectedId(item.id); setOpenedThread(null); setForm(null); setError(''); setReviewed(false); }} aria-current={project?.id === item.id ? 'page' : undefined}
          className={`w-full rounded-xl px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-droid-text-muted ${project?.id === item.id && !form ? 'bg-droid-active' : 'hover:bg-droid-elevated'}`}>
          <div className="truncate text-[13px] font-medium">{item.title}</div>
          <div className="mt-0.5 text-[10px] text-droid-text-muted">{item.threads.length} threads{item.paused ? ' · Paused' : ''}</div>
        </button>)}</div>
      </aside>
      <section aria-label="Project workspace" className="flex min-h-0 min-w-0 flex-1 flex-col">
        {snapshot.error && <div role="alert" className="flex items-center gap-3 border-b border-droid-border/50 px-6 py-3 text-xs text-droid-text-secondary"><span className="flex-1">{snapshot.error}</span><button type="button" onClick={refreshProjects} className="rounded-lg p-1.5 hover:bg-droid-elevated" aria-label="Reload projects"><RefreshCw size={14} /></button></div>}
        {form ? <div className="overflow-auto px-6 py-8"><NewThreadForm key={form.ownerId ?? 'new'} owner={owner} cwd={owner?.cwd ?? cwd} onSubmit={submit} onCancel={() => setForm(null)} /></div> : !project ? <div className="mx-auto flex max-w-md flex-col items-center px-6 pt-24 text-center">
          <div className="mb-4 rounded-2xl border border-droid-border/60 bg-droid-elevated/40 p-3"><MessageCirclePlus size={20} className="text-droid-text-secondary" /></div>
          <h1 className="text-[20px] font-semibold tracking-tight">{snapshot.loading ? 'Loading projects…' : 'Projects'}</h1>
          <p className="mt-2 text-[12px] leading-5 text-droid-text-muted">Independent conversations, one local workspace. Each thread keeps its own history.</p>
          {!snapshot.loading && !snapshot.error && <button type="button" onClick={() => setForm({})} className="mt-5 rounded-xl bg-droid-text px-4 py-2 text-xs font-medium text-droid-bg">Create project</button>}
        </div> : <>
          <header className="shrink-0 border-b border-droid-border/50 px-6 pb-3 pt-3">
            <div className="flex items-center gap-3">
              <h1 className="min-w-0 flex-1 truncate text-[20px] font-semibold tracking-tight">{project.title}</h1>
              <button type="button" disabled={pending || (project.paused && project.uncertain > 0 && !reviewed)} onClick={() => void togglePaused()} className="rounded-xl border border-droid-border/60 px-3 py-1.5 text-xs text-droid-text-secondary hover:bg-droid-elevated disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-droid-text-muted">{pending ? 'Saving…' : project.paused ? 'Resume coordination' : 'Pause coordination'}</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-droid-text-muted">
              <span>{project.threads.length} threads</span><span>{project.queued} queued messages</span><span>{project.wakesLeft} automatic wakes left</span>
              {project.launching > 0 && <span>Starting {project.launching} thread{project.launching === 1 ? '' : 's'}…</span>}
            </div>
            <div className="mt-3 flex gap-1" aria-label="Project views">
              <button type="button" aria-pressed={!active} onClick={() => setOpenedThread(null)} className={`rounded-lg px-3 py-1.5 text-xs ${!active ? 'bg-droid-active' : 'text-droid-text-muted hover:bg-droid-elevated'}`}>Threads</button>
              {root && <button type="button" aria-pressed={active?.appSessionId === root.appSessionId} onClick={() => openThread(root.appSessionId)} className={`rounded-lg px-3 py-1.5 text-xs ${active?.appSessionId === root.appSessionId ? 'bg-droid-active' : 'text-droid-text-muted hover:bg-droid-elevated'}`}>Main chat</button>}
              {active?.ownerAppSessionId && <span className="max-w-[220px] truncate rounded-lg bg-droid-active px-3 py-1.5 text-xs">{active.title}</span>}
            </div>
            {(error || project.error) && <p role="alert" className="mt-3 text-xs leading-5 text-droid-text-secondary">{error || project.error}</p>}
            {project.uncertain > 0 && <div className="mt-3 rounded-xl border border-droid-border/60 p-3 text-xs text-droid-text-secondary">
              <p>A previous wake may already have reached its conversation. It will not be sent again automatically.</p>
              <div className="my-2 flex flex-wrap gap-2">{project.uncertainTargets.map((id) => <button type="button" key={id} onClick={() => openThread(id)} className="rounded-lg bg-droid-elevated px-2 py-1">Review {project.threads.find((thread) => thread.appSessionId === id)?.title ?? 'thread'}</button>)}</div>
              <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I reviewed these conversations. Discard the uncertain wake without resending it.</label>
            </div>}
          </header>
          {active ? <div className="flex min-h-0 flex-1 flex-col"><ChatView rightInset={false} /><PromptInput rightInset={false} /></div> : <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
            <p className="mb-5 text-[11px] leading-5 text-droid-text-muted">This draft supports the controls below. Agent-native thread tools are not connected yet; no MCP server is added.</p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{project.threads.map((thread) => <ProjectThreadCard key={thread.appSessionId} thread={thread} ownerTitle={project.threads.find((item) => item.appSessionId === thread.ownerAppSessionId)?.title} disabled={project.paused || pending || project.threads.length + project.launching >= 8} onOpen={() => openThread(thread.appSessionId)} onSpawn={() => setForm({ ownerId: thread.appSessionId })} onStop={() => {
              if (!root) return;
              setPending(true);
              setError('');
              void stopThread(root.appSessionId, thread.appSessionId).catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => setPending(false));
            }} />)}</div>
          </div>}
        </>}
      </section>
    </div>
  </div>;
}
