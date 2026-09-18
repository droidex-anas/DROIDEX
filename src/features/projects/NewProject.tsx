import { useState, type FormEvent } from 'react';
import { ArrowUp, GitBranch } from 'lucide-react';
import AutonomySelector from '../../components/AutonomySelector';
import { useStoreSelector } from '../../hooks/useStore';
import type { Autonomy, ProviderKind, ReasoningEffort } from '../../types/bridge';
import ProviderPicker from '../providers/ProviderPicker';
import { providerDefaultModel, providerUnavailableReason } from '../providers/providerIdentity';
import { createProject } from './client';

export default function NewProject({ cwd, onCreated }: { cwd: string; onCreated: (id: string) => void }) {
  const statuses = useStoreSelector((state) => state.providerStatuses);
  const defaultAutonomy = useStoreSelector((state) => state.defaultAutonomy);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [workspace, setWorkspace] = useState(cwd);
  const [provider, setProvider] = useState<ProviderKind>('droid');
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelId, setModelId] = useState('');
  const [reasoning, setReasoning] = useState<ReasoningEffort>();
  const [autonomy, setAutonomy] = useState<Autonomy>(defaultAutonomy);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const status = statuses.find((item) => item.provider === provider);
  const models = status?.models ?? [];
  const defaultModel = providerDefaultModel(provider, models, statuses);
  const model = models.find((item) => item.id === modelId) ?? defaultModel;
  const efforts = model?.supportedReasoningEfforts ?? [];
  const unavailable = providerUnavailableReason(status);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (pending || !prompt.trim() || unavailable) return;
    setPending(true);
    setError('');
    try {
      const id = await createProject({
        title: title.trim() || prompt.trim().split('\n')[0].slice(0, 80),
        prompt: prompt.trim(), provider, autonomy,
        ...(workspace.trim() ? { cwd: workspace.trim() } : {}),
        ...(model?.id ? { modelId: model.id } : {}),
        ...(reasoning ? { reasoningEffort: reasoning } : {}),
      });
      onCreated(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { setPending(false); }
  }

  const selectClass = 'min-w-0 max-w-[220px] rounded-lg bg-transparent px-2 py-1 text-xs text-droid-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-droid-text-muted';
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-droid-elevated text-droid-text-secondary"><GitBranch size={20} /></span>
        <div>
          <h1 className="text-xl font-medium tracking-tight text-droid-text">One conversation. Several threads.</h1>
          <p className="mt-1 text-sm text-droid-text-muted">A local workspace for your main agent and the threads it coordinates.</p>
        </div>
      </div>
      <form onSubmit={(event) => void submit(event)} className="rounded-2xl border border-droid-border bg-droid-bg/40 p-4 shadow-sm">
        <input aria-label="Project name" placeholder="Project name (optional)" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} disabled={pending}
          className="mb-3 w-full bg-transparent text-sm font-medium text-droid-text outline-none placeholder:text-droid-text-muted focus-visible:ring-1 focus-visible:ring-droid-border rounded-lg px-2 py-1" />
        <textarea aria-label="Project task" placeholder="What are we building? Describe the goal, then let the main thread divide the work." value={prompt} maxLength={8_192} onChange={(event) => setPrompt(event.target.value)} disabled={pending} required rows={5}
          className="w-full resize-y rounded-xl bg-transparent px-2 text-sm leading-relaxed text-droid-text outline-none placeholder:text-droid-text-muted focus-visible:ring-1 focus-visible:ring-droid-border" />
        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-droid-border pt-3">
          <ProviderPicker value={provider} locked={pending} open={providerOpen} onOpenChange={setProviderOpen} onSelect={(value) => { setProvider(value); setModelId(''); setReasoning(undefined); }} />
          <select aria-label="Main thread model" value={modelId} disabled={pending} onChange={(event) => { setModelId(event.target.value); setReasoning(undefined); }} className={selectClass}>
            <option value="">{defaultModel?.displayName ?? 'Harness default'}</option>
            {models.filter((item) => item.id !== defaultModel?.id).map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
          </select>
          {efforts.length > 0 && <select aria-label="Main thread reasoning" value={reasoning ?? ''} disabled={pending} onChange={(event) => setReasoning(efforts.find((effort) => effort === event.target.value))} className={selectClass}>
            <option value="">Default reasoning</option>
            {efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
          </select>}
          <AutonomySelector scope="draft" value={autonomy} disabled={pending} onSelect={setAutonomy} placement="down" />
          <button type="submit" aria-label="Create project" disabled={pending || !prompt.trim() || Boolean(unavailable)} title={unavailable ?? 'Create project'}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-xl bg-droid-text text-droid-bg transition-opacity hover:opacity-80 disabled:opacity-30">
            {pending ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : <ArrowUp size={16} />}
          </button>
        </div>
        <label className="mt-4 flex items-center gap-2 text-xs text-droid-text-muted">Workspace
          <input aria-label="Project workspace" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="Optional absolute folder path" disabled={pending} maxLength={4_096}
            className="min-w-0 flex-1 rounded-lg bg-droid-elevated px-2 py-1.5 text-droid-text-secondary outline-none focus-visible:ring-1 focus-visible:ring-droid-text-muted" />
        </label>
      </form>
      {(error || unavailable) && <p role="alert" className="mt-3 text-sm text-droid-text-secondary">{error || unavailable}</p>}
      <p className="mt-4 text-center text-xs leading-relaxed text-droid-text-muted">The watcher runs locally. Agents only receive a new turn when there is work to do.<br />Threads share the selected folder; ask the main agent to avoid overlapping file edits.</p>
    </div>
  );
}
