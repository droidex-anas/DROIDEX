import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Search } from 'lucide-react';
import { Clock, MessageSquareText, Plus, Spinner } from '@droidex/icons';
import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceScope } from '../../lib/workspaces';
import { toast } from '../../lib/toast';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import type { ModelInfo, ReasoningEffort, SessionSummary } from '../../types/bridge';
import { AutomationEditor } from './AutomationEditor';
import { AutomationList } from './AutomationList';
import type { AutomationEditorRequest } from '../../hooks/useStore';
import { AUTOMATION_SUGGESTIONS, type AutomationSuggestion } from './suggestions';
import {
  createAutomation,
  deleteAutomation,
  requestAutomationSnapshot,
  runAutomationNow,
  setAutomationEnabled,
  updateAutomation,
  useAutomationSnapshot,
} from './client';
import {
  automationWorkspaceIssue,
  automationToDraft,
  defaultAutomationDraft,
  latestRunsByAutomation,
  resolveAutomationModelDefaults,
  validateAutomationDraft,
} from './schedule';
import type {
  Automation,
  AutomationDraft,
  AutomationEditorState,
  AutomationSnapshot,
} from './types';

interface AutomationsViewProps {
  workspaceScopes: readonly WorkspaceScope[];
  workspaceScopesReady: boolean;
  currentWorkspaceCwd: string | null;
  models: ModelInfo[];
  sessions: Partial<Record<string, SessionSummary>>;
  defaultModelId?: string | null;
  defaultReasoningEffort?: ReasoningEffort | null;
  onChatWithDroidex: () => void;
  onOpenSession: (appSessionId: string) => void;
  editorRequest: AutomationEditorRequest | null;
  onEditorRequestHandled: (requestId: number) => void;
}

type Filter = 'all' | 'prompts' | 'active' | 'paused';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'prompts', label: 'Scheduled prompts' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
];

export function AutomationsView({
  workspaceScopes,
  workspaceScopesReady,
  currentWorkspaceCwd,
  models,
  sessions,
  defaultModelId,
  defaultReasoningEffort,
  onChatWithDroidex,
  onOpenSession,
  editorRequest,
  onEditorRequestHandled,
}: AutomationsViewProps) {
  const snapshot = useAutomationSnapshot();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<AutomationEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [followManualRunId, setFollowManualRunId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    requestAutomationSnapshot();
  }, []);

  // Only live runs show second-level elapsed time; idle rows change at most once
  // a minute, so the idle tick stays cheap instead of re-rendering the list twice
  // a minute for nothing.
  useEffect(() => {
    setNow(Date.now());
    const active = snapshot.activeRunCount > 0;
    const timer = window.setInterval(
      () => {
        setNow(Date.now());
      },
      active ? 1_000 : 60_000,
    );
    return () => {
      window.clearInterval(timer);
    };
  }, [snapshot.activeRunCount]);

  useEffect(() => {
    if (!pendingDeleteId) return;
    const timer = window.setTimeout(() => {
      setPendingDeleteId(null);
    }, 4_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [pendingDeleteId]);

  const defaultWorkspaceCwd = useMemo(() => {
    if (!currentWorkspaceCwd) return null;
    return (
      workspaceScopes.find((scope) => scope.executionCwds.includes(currentWorkspaceCwd))?.cwd ??
      currentWorkspaceCwd
    );
  }, [currentWorkspaceCwd, workspaceScopes]);
  const modelDefaults = useMemo(
    () => resolveAutomationModelDefaults(models, defaultModelId, defaultReasoningEffort),
    [defaultModelId, defaultReasoningEffort, models],
  );
  const latestRuns = useMemo(() => latestRunsByAutomation(snapshot.runs), [snapshot.runs]);

  // A proposal card can send the user here to edit one automation; the snapshot
  // may still be in flight when this mounts, so the request stays pending until
  // its automation appears (route changes clear it).
  useEffect(() => {
    if (!editorRequest) return;
    const automation = snapshot.automations.find(
      (candidate) => candidate.id === editorRequest.automationId,
    );
    if (!automation) return;
    setEditor(editAutomationState(automation, modelDefaults));
    onEditorRequestHandled(editorRequest.requestId);
  }, [editorRequest, modelDefaults, onEditorRequestHandled, snapshot.automations]);

  useEffect(() => {
    if (!followManualRunId) return;
    const run = snapshot.runs.find((candidate) => candidate.id === followManualRunId);
    if (!run) return;
    if (run.appSessionId) {
      setFollowManualRunId(null);
      onOpenSession(run.appSessionId);
      return;
    }
    if (run.status === 'failed') {
      setFollowManualRunId(null);
      toast.error(run.error ?? 'The automation could not start.');
    }
  }, [followManualRunId, onOpenSession, snapshot.runs]);

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return snapshot.automations.filter((automation) => {
      if (filter === 'active' && !automation.enabled) return false;
      if (filter === 'paused' && automation.enabled) return false;
      if (filter === 'prompts' && automation.target.kind !== 'existing-session') return false;
      if (!normalizedQuery) return true;
      return `${automation.title}\n${automation.prompt}\n${automation.workspaceCwd ?? ''}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [filter, query, snapshot.automations]);

  const loadingSnapshot = isSnapshotLoading(snapshot);

  const createDraft = (patch?: Partial<AutomationDraft>) => {
    setEditor({
      mode: 'create',
      draft: {
        ...defaultAutomationDraft(
          defaultWorkspaceCwd,
          modelDefaults.modelId,
          modelDefaults.reasoningEffort,
        ),
        ...patch,
      },
    });
  };

  const editAutomation = (automation: Automation) => {
    setEditor(editAutomationState(automation, modelDefaults));
  };

  const saveEditor = async () => {
    if (!editor || saving) return;
    // Time-dependent rules (a one-time run that has since passed) can go stale
    // while the drawer stays open, so the draft is checked again before writing.
    const issue =
      validateAutomationDraft(editor.draft, models) ??
      automationWorkspaceIssue(editor.draft, workspaceScopes, workspaceScopesReady);
    if (issue) {
      toast.error(issue);
      return;
    }
    setSaving(true);
    try {
      if (editor.mode === 'create') await createAutomation(editor.draft);
      else {
        await updateAutomation(editor.automation.id, editor.draft);
      }
      setEditor((current) => (current === editor ? null : current));
      toast.success(editor.mode === 'create' ? 'Automation created.' : 'Automation updated.');
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  };

  const deleteRow = async (automation: Automation) => {
    if (pendingDeleteId !== automation.id) {
      setPendingDeleteId(automation.id);
      return;
    }
    try {
      await deleteAutomation(automation.id);
      setPendingDeleteId(null);
      if (editor?.mode === 'edit' && editor.automation.id === automation.id) setEditor(null);
      toast.success('Automation deleted.');
    } catch (error) {
      showError(error);
    }
  };

  const statusSummary = [
    snapshot.activeRunCount ? `${String(snapshot.activeRunCount)} running` : '',
    snapshot.queuedRunCount ? `${String(snapshot.queuedRunCount)} queued` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      data-testid="automations-workspace"
      className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-bg text-primary"
    >
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Outside the scroller, so the heading never slides under the window
            controls that sit in this strip when the sidebar is collapsed. */}
        <div data-electron-drag-region className="h-9 shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-8 pb-16 pt-3">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <h1 className="text-title">Automations</h1>
                  {statusSummary && <Badge tone="neutral">{statusSummary}</Badge>}
                </div>
                <p className="mt-1 max-w-2xl text-body-lg text-muted">
                  Schedule tasks and automations to run through DROIDEX on the model, workspace, and
                  timezone you choose.
                </p>
                <div className="mt-2 flex items-center gap-1.5 text-caption text-muted/75">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      snapshot.scheduler.ready ? 'bg-accent/70' : 'bg-muted/35'
                    }`}
                  />
                  <span>
                    {schedulerStatus(snapshot.scheduler.nextWakeAt, snapshot.scheduler.ready)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" icon={MessageSquareText} onClick={onChatWithDroidex}>
                  Chat with DROIDEX
                </Button>
                <Button
                  variant="primary"
                  icon={Plus}
                  onClick={() => {
                    createDraft();
                  }}
                >
                  Create automation
                </Button>
              </div>
            </div>

            {loadingSnapshot ? (
              <div className="mt-8 flex items-center gap-2 text-body text-muted">
                <Spinner className="size-icon-md motion-safe:animate-spin-slow" />
                Loading automations…
              </div>
            ) : (
              <>
                <div className="relative mt-8">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 size-icon-sm -translate-y-1/2 text-muted"
                  />
                  <Input
                    value={query}
                    aria-label="Search automations"
                    onChange={(event) => {
                      setQuery(event.target.value);
                    }}
                    placeholder="Search automations"
                    className="pl-8"
                  />
                </div>

                <div
                  className="mt-5 flex flex-wrap items-center gap-1"
                  aria-label="Filter automations"
                >
                  {FILTERS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={filter === value}
                      onClick={() => {
                        setFilter(value);
                      }}
                      className={`rounded-md px-3 py-1.5 text-label transition-colors ${
                        filter === value
                          ? 'bg-elevated text-primary'
                          : 'text-muted hover:bg-elevated/50 hover:text-primary'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {visible.length > 0 && (
                  <AutomationList
                    automations={visible}
                    latestRuns={latestRuns}
                    models={models}
                    sessions={sessions}
                    now={now}
                    pendingDeleteId={pendingDeleteId}
                    onEdit={editAutomation}
                    onToggle={(automation, enabled) =>
                      void setAutomationEnabled(automation.id, enabled).catch(showError)
                    }
                    onRun={(automation) => {
                      void runAutomationNow(automation.id)
                        .then((runId) => {
                          setFollowManualRunId(runId);
                          toast.success('Starting automation…');
                        })
                        .catch((error: unknown) => {
                          setFollowManualRunId(null);
                          showError(error);
                        });
                    }}
                    onOpenSession={onOpenSession}
                    onDelete={(automation) => void deleteRow(automation)}
                  />
                )}

                {visible.length === 0 && snapshot.automations.length > 0 && (
                  <div className="py-12 text-center text-body text-muted">
                    No automations match this view.
                  </div>
                )}

                {snapshot.automations.length === 0 && (
                  <p className="mt-8 text-body text-muted">
                    To continue an existing conversation later, choose Schedule prompt beside its
                    Send button.
                  </p>
                )}

                {snapshot.automations.length === 0 && (
                  <SuggestionList
                    onPick={(draft) => {
                      createDraft(draft);
                    }}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <AnimatePresence initial={false}>
        {editor && (
          <motion.div
            key="automation-editor"
            initial={reduceMotion ? { opacity: 1 } : { x: 28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { x: 24, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-y-0 right-0 z-20 w-full max-w-md"
          >
            <AutomationEditor
              editor={editor}
              workspaceScopes={workspaceScopes}
              workspaceScopesReady={workspaceScopesReady}
              models={models}
              saving={saving}
              targetTitle={
                editor.draft.target.kind === 'existing-session'
                  ? sessions[editor.draft.target.appSessionId]?.title
                  : undefined
              }
              onChange={(draft) => {
                setEditor((current) => (current ? { ...current, draft } : current));
              }}
              onSave={() => void saveEditor()}
              onClose={() => {
                setEditor(null);
              }}
            />
            {saving && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/30">
                <Spinner className="size-icon-lg motion-safe:animate-spin-slow text-muted" />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function editAutomationState(
  automation: Automation,
  defaults: { modelId: string | null; reasoningEffort: ReasoningEffort | null },
): AutomationEditorState {
  const draft = automationToDraft(automation);
  if (draft.target.kind === 'new-session') {
    draft.modelId ??= defaults.modelId;
    draft.reasoningEffort ??= defaults.reasoningEffort;
  }
  return { mode: 'edit', automation, draft };
}

// The snapshot arrives over the bridge: until the scheduler reports ready and
// has listed what it holds, there is nothing to search, filter, or suggest.
function isSnapshotLoading(snapshot: AutomationSnapshot): boolean {
  return !snapshot.scheduler.ready && snapshot.automations.length === 0;
}

function SuggestionList({ onPick }: { onPick: (draft: AutomationSuggestion['draft']) => void }) {
  return (
    <section className="mt-8">
      <h2 className="text-label text-muted">Suggestions</h2>
      <div className="mt-2 overflow-hidden rounded-xl bg-surface dark:bg-surface/20">
        {AUTOMATION_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.title}
            type="button"
            onClick={() => {
              onPick(suggestion.draft);
            }}
            className="group flex w-full items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-elevated dark:hover:bg-elevated/45"
          >
            <span className="mt-0.5 flex size-control-md items-center justify-center rounded-lg bg-bg text-muted transition-colors group-hover:text-primary dark:bg-surface">
              <Clock className="size-icon-md" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-body-strong text-primary">{suggestion.title}</span>
              <span className="mt-1 block text-body text-muted">{suggestion.detail}</span>
            </span>
            <Plus className="mt-1 size-icon-md text-muted/65 transition-colors group-hover:text-primary" />
          </button>
        ))}
      </div>
    </section>
  );
}

function schedulerStatus(nextWakeAt: number | null, ready: boolean): string {
  if (!ready) return 'Scheduler reconnecting';
  if (nextWakeAt === null) return 'Scheduler active · no upcoming runs';
  return `Scheduler active · next wake ${new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(nextWakeAt)}`;
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : 'Automation request failed.');
}
