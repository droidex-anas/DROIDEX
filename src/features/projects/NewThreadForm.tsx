import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUp, FolderOpen } from 'lucide-react';
import AutonomySelector from '../../components/AutonomySelector';
import { useStoreSelector } from '../../hooks/useStore';
import { refreshProviders } from '../../lib/commands';
import { pickDirectory } from '../../lib/desktop';
import type { Autonomy, ProviderKind, ReasoningEffort, SessionSummary } from '../../types/bridge';
import ProviderPicker from '../providers/ProviderPicker';
import { providerDefaultModel, providerUnavailableReason } from '../providers/providerIdentity';
import type { ThreadInput } from './types';

export function NewThreadForm({ owner, cwd, onSubmit, onCancel }: {
  owner?: SessionSummary;
  cwd: string;
  onSubmit: (input: ThreadInput) => Promise<void>;
  onCancel: () => void;
}) {
  useEffect(() => { refreshProviders(); }, []);
  const statuses = useStoreSelector((state) => state.providerStatuses);
  const defaultAutonomy = useStoreSelector((state) => state.defaultAutonomy);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [workspace, setWorkspace] = useState(cwd);
  const [provider, setProvider] = useState<ProviderKind>(owner?.provider ?? 'droid');
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelId, setModelId] = useState(owner?.modelId ?? '');
  const [reasoning, setReasoning] = useState<ReasoningEffort>();
  const [autonomy, setAutonomy] = useState<Autonomy>(owner?.autonomy ?? defaultAutonomy);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const status = statuses.find((item) => item.provider === provider);
  const models = status?.models ?? [];
  const defaultModel = providerDefaultModel(provider, models, statuses);
  const model = models.find((item) => item.id === modelId) ?? (modelId ? undefined : defaultModel);
  const efforts = model?.supportedReasoningEfforts ?? [];
  const unavailable = providerUnavailableReason(status);
  const selectClass = 'min-w-0 max-w-[220px] rounded-lg bg-droid-elevated px-2 py-1.5 text-xs text-droid-text-secondary outline-none focus-visible:ring-2 focus-visible:ring-droid-text-muted';

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (pending || !prompt.trim() || unavailable) return;
    setPending(true);
    setError('');
    try {
      const selectedModel = modelId || defaultModel?.id;
      const selectedReasoning = reasoning && efforts.includes(reasoning) ? reasoning : undefined;
      await onSubmit({
        title: title.trim() || prompt.trim().split('\n')[0].slice(0, 80),
        prompt: prompt.trim(), provider, autonomy,
        ...(workspace.trim() ? { cwd: workspace.trim() } : {}),
        ...(selectedModel ? { modelId: selectedModel } : {}),
        ...(selectedReasoning ? { reasoningEffort: selectedReasoning } : {}),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  }

  return <form onSubmit={(event) => void submit(event)} className="mx-auto w-full max-w-2xl rounded-2xl border border-droid-border/60 bg-droid-elevated/25 p-5">
    <h2 className="mb-1 text-lg font-medium tracking-tight">{owner ? 'New thread' : 'New project'}</h2>
    <p className="mb-5 text-xs text-droid-text-muted">{owner ? `Managed by ${owner.title}` : 'Start a main conversation, then add independent threads.'}</p>
    <label className="block text-xs text-droid-text-secondary">Name
      <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={pending} maxLength={120} placeholder="Optional short name"
        className="mt-1 mb-4 w-full rounded-xl border border-droid-border/50 bg-droid-bg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-droid-text-muted" />
    </label>
    <label className="block text-xs text-droid-text-secondary">Task
      <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} disabled={pending} maxLength={8_192} required rows={5} placeholder="Describe the work for this conversation."
        className="mt-1 w-full resize-y rounded-xl border border-droid-border/50 bg-droid-bg px-3 py-2 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-droid-text-muted" />
    </label>
    <div className="my-4 flex flex-wrap items-center gap-2">
      <ProviderPicker value={provider} locked={pending} open={providerOpen} onOpenChange={setProviderOpen} onSelect={(value) => { setProvider(value); setModelId(''); setReasoning(undefined); }} />
      <select aria-label="Thread model" value={modelId} disabled={pending} onChange={(event) => { setModelId(event.target.value); setReasoning(undefined); }} className={selectClass}>
        <option value="">{defaultModel?.displayName ?? 'Harness default'}</option>
        {modelId && !models.some((item) => item.id === modelId) && <option value={modelId}>{modelId} (current)</option>}
        {models.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
      </select>
      {efforts.length > 0 && <select aria-label="Thread reasoning" value={reasoning ?? ''} disabled={pending} onChange={(event) => setReasoning(efforts.find((effort) => effort === event.target.value))} className={selectClass}>
        <option value="">Default reasoning</option>
        {efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
      </select>}
      <AutonomySelector scope="draft" value={autonomy} disabled={pending} onSelect={setAutonomy} placement="down" />
    </div>
    {!owner && <label className="mb-4 block text-xs text-droid-text-secondary">Workspace
      <div className="mt-1 flex gap-2">
        <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} disabled={pending} maxLength={4_096} placeholder="Optional absolute folder path" className="min-w-0 flex-1 rounded-xl border border-droid-border/50 bg-droid-bg px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-droid-text-muted" />
        <button type="button" aria-label="Choose workspace folder" disabled={pending} onClick={() => {
          void pickDirectory().then((path) => { if (path) setWorkspace(path); }).catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : String(failure)); });
        }} className="rounded-xl px-3 hover:bg-droid-elevated focus-visible:ring-2 focus-visible:ring-droid-text-muted"><FolderOpen size={16} /></button>
      </div>
    </label>}
    {(error || unavailable) && <p role="alert" className="mb-3 text-xs leading-5 text-droid-text-secondary">{error || unavailable}</p>}
    <div className="flex items-center justify-between gap-3 border-t border-droid-border/50 pt-4">
      <button type="button" disabled={pending} onClick={onCancel} className="rounded-lg px-3 py-2 text-xs text-droid-text-muted hover:bg-droid-elevated focus-visible:ring-2 focus-visible:ring-droid-text-muted">Cancel</button>
      <button type="submit" disabled={pending || !prompt.trim() || Boolean(unavailable)} className="flex items-center gap-2 rounded-xl bg-droid-text px-3 py-2 text-xs font-medium text-droid-bg transition-opacity hover:opacity-80 disabled:opacity-40">
        {pending ? 'Starting…' : owner ? 'Start thread' : 'Create project'}<ArrowUp size={14} />
      </button>
    </div>
  </form>;
}
