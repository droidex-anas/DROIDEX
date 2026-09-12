import { MessageSquareText, X } from 'lucide-react';
import { useMemo } from 'react';
import { FileChip } from '../../components/composer/FileChip';
import type { WorkspaceScope } from '../../lib/workspaces';
import type { ModelInfo } from '../../types/bridge';
import { AutomationModelPicker } from './AutomationModelPicker';
import { SelectMenu } from './SelectMenu';
import {
  AUTOMATION_AUTONOMY_OPTIONS,
  automationWorkspaceIssue,
  convertOnceRunAt,
  supportedTimeZones,
  validateAutomationDraft,
  workspaceLabel,
} from './schedule';
import { EditorRow, ScheduleControls, scheduleForKind } from './ScheduleControls';
import type { AutomationDraft, AutomationEditorState, AutomationSchedule } from './types';

interface AutomationEditorProps {
  editor: AutomationEditorState;
  workspaceScopes: readonly WorkspaceScope[];
  // Saving waits for discovery so a path cannot disappear between load and edit.
  workspaceScopesReady: boolean;
  models: ModelInfo[];
  saving: boolean;
  targetTitle?: string | undefined;
  onChange: (draft: AutomationDraft) => void;
  onSave: () => void;
  onClose: () => void;
}

const CONTROL =
  'w-full rounded-xl border border-droid-border bg-droid-surface/55 px-3 py-2.5 text-[13px] text-droid-text outline-none transition-colors placeholder:text-droid-text-muted focus:border-droid-border-hover focus:bg-droid-surface';

export function AutomationEditor({
  editor,
  workspaceScopes,
  workspaceScopesReady,
  models,
  saving,
  targetTitle,
  onChange,
  onSave,
  onClose,
}: AutomationEditorProps) {
  const { draft } = editor;
  const isDelivery = draft.target.kind === 'existing-session';
  const validation = useMemo(
    () =>
      validateAutomationDraft(draft, models) ??
      automationWorkspaceIssue(draft, workspaceScopes, workspaceScopesReady),
    [draft, models, workspaceScopes, workspaceScopesReady],
  );
  const timeZones = useMemo(
    () =>
      supportedTimeZones().map((timezone) => ({
        value: timezone,
        label: timezone
          .split('/')
          .map((part) => part.replaceAll('_', ' '))
          .join(' / '),
        keywords: timezone,
      })),
    [],
  );

  const update = <Key extends keyof AutomationDraft>(key: Key, value: AutomationDraft[Key]) => {
    onChange({ ...draft, [key]: value });
  };
  const updateSchedule = (schedule: AutomationSchedule) => {
    update('schedule', schedule);
  };
  const updateTimezone = (timezone: string) => {
    if (draft.schedule.kind !== 'once') {
      update('timezone', timezone);
      return;
    }
    const runAt = convertOnceRunAt(draft.schedule.runAt, draft.timezone, timezone);
    if (runAt === null) return;
    onChange({
      ...draft,
      timezone,
      schedule: {
        kind: 'once',
        runAt,
      },
    });
  };

  return (
    <aside
      aria-busy={saving}
      className="flex h-full w-full flex-col border-l border-droid-border bg-droid-bg shadow-droid"
    >
      <div data-electron-drag-region className="h-9 shrink-0" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-5 pb-3 pt-2">
          <div>
            <div className="text-[12px] font-medium text-droid-text-secondary">
              {isDelivery
                ? 'Scheduled prompt'
                : editor.mode === 'create'
                  ? 'New automation'
                  : 'Edit automation'}
            </div>
            <div className="mt-0.5 text-[11px] text-droid-text-muted">
              {isDelivery
                ? 'Continue a conversation at the right time'
                : 'Schedule a task that runs as a DROIDEX chat'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
            aria-label="Close automation editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <fieldset disabled={saving} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 pb-8">
          <input
            aria-label="Automation title"
            value={draft.title}
            onChange={(event) => {
              update('title', event.target.value);
            }}
            placeholder="Automation title"
            className="mb-4 w-full bg-transparent text-[22px] font-medium tracking-[-0.02em] text-droid-text outline-none placeholder:text-droid-text-muted"
            autoFocus
          />
          <textarea
            aria-label="Automation prompt"
            value={draft.prompt}
            onChange={(event) => {
              update('prompt', event.target.value);
            }}
            placeholder={
              isDelivery
                ? 'What should DROIDEX do next?'
                : 'Describe the task DROIDEX should complete each time'
            }
            rows={6}
            className={`${CONTROL} resize-none leading-5`}
          />
          {draft.files.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Scheduled attachments">
              {draft.files.map((path) => (
                <FileChip
                  key={path}
                  path={path}
                  onRemove={() => {
                    update(
                      'files',
                      draft.files.filter((file) => file !== path),
                    );
                  }}
                />
              ))}
            </div>
          )}

          {isDelivery ? (
            <div className="mt-5 flex items-start gap-2.5 text-[12px] text-droid-text-secondary">
              <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-droid-text-muted" />
              <div className="min-w-0">
                <p className="truncate">{targetTitle ?? 'Original conversation'}</p>
                <p className="mt-1 text-[11px] leading-4 text-droid-text-muted">
                  Keeps its model, workspace, and permissions. No new chat is created.
                </p>
              </div>
            </div>
          ) : (
            <>
              <SectionLabel>Run configuration</SectionLabel>
              <div className="overflow-visible rounded-2xl border border-droid-border bg-droid-surface/35">
                <EditorRow label="Model">
                  <AutomationModelPicker
                    models={models}
                    modelId={draft.modelId}
                    reasoningEffort={draft.reasoningEffort}
                    onChange={(selection) => {
                      onChange({
                        ...draft,
                        modelId: selection.modelId,
                        reasoningEffort: selection.reasoningEffort,
                      });
                    }}
                  />
                </EditorRow>
                <EditorRow label="Autonomy">
                  <SelectMenu
                    value={draft.autonomy}
                    ariaLabel="Automation autonomy"
                    onChange={(value) => {
                      update('autonomy', value);
                    }}
                    options={AUTOMATION_AUTONOMY_OPTIONS}
                  />
                </EditorRow>
                <EditorRow label="Workspace">
                  <SelectMenu
                    value={draft.workspaceCwd ?? ''}
                    ariaLabel="Automation workspace"
                    searchable
                    width={330}
                    onChange={(value) => {
                      onChange({
                        ...draft,
                        workspaceCwd: value || null,
                        executionMode: value ? draft.executionMode : 'local',
                      });
                    }}
                    options={[
                      { value: '', label: 'No workspace', detail: 'Run as a folder-less chat' },
                      ...workspaceScopes.map((scope) => ({
                        value: scope.cwd,
                        label: workspaceLabel(scope.cwd),
                        detail: scope.cwd,
                      })),
                    ]}
                  />
                </EditorRow>
                <EditorRow label="Checkout" last>
                  <SelectMenu
                    value={draft.executionMode}
                    ariaLabel="Automation checkout mode"
                    disabled={!draft.workspaceCwd}
                    onChange={(value) => {
                      update('executionMode', value);
                    }}
                    options={[
                      {
                        value: 'local',
                        label: 'Current workspace',
                        detail: 'Runs in the selected checkout',
                      },
                      {
                        value: 'worktree',
                        label: 'Isolated worktree',
                        detail: 'Creates a clean detached checkout for the run',
                      },
                    ]}
                  />
                </EditorRow>
              </div>
            </>
          )}

          <SectionLabel>Schedule</SectionLabel>
          <div className="overflow-visible rounded-2xl border border-droid-border bg-droid-surface/35">
            {!isDelivery && (
              <EditorRow label="Repeat">
                <SelectMenu
                  value={draft.schedule.kind}
                  ariaLabel="Automation frequency"
                  onChange={(value) => {
                    updateSchedule(scheduleForKind(value, draft.schedule));
                  }}
                  options={[
                    { value: 'once', label: 'Once' },
                    { value: 'hourly', label: 'Hourly' },
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekdays', label: 'Weekdays' },
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'cron', label: 'Custom schedule' },
                  ]}
                />
              </EditorRow>
            )}
            <ScheduleControls
              schedule={draft.schedule}
              timezone={draft.timezone}
              onChange={updateSchedule}
            />
            <EditorRow label="Time zone">
              <SelectMenu
                value={draft.timezone}
                ariaLabel="Automation timezone"
                searchable
                width={340}
                options={timeZones}
                onChange={updateTimezone}
              />
            </EditorRow>
            <EditorRow label="Status" last>
              <SelectMenu
                value={draft.enabled ? 'active' : 'paused'}
                ariaLabel="Automation status"
                onChange={(value) => {
                  update('enabled', value === 'active');
                }}
                options={[
                  { value: 'active', label: 'Active', detail: 'Runs at the scheduled time' },
                  {
                    value: 'paused',
                    label: 'Paused',
                    detail: 'Keeps the automation without running it',
                  },
                ]}
              />
            </EditorRow>
          </div>

          <div className="mt-4 rounded-xl border border-droid-border/70 bg-droid-surface/25 px-3 py-2.5 text-[11px] leading-4 text-droid-text-muted">
            {isDelivery
              ? 'Sends once, after any active turn finishes. Delivered means the conversation accepted the prompt, not that the agent finished its work. Attachments are saved copies.'
              : 'Every run opens as a background chat. Open it here to follow its progress.'}{' '}
            If DROIDEX is asleep or closed at the scheduled time, it catches up when available
            again.
          </div>
        </fieldset>

        <div className="border-t border-droid-border px-5 py-4">
          {validation && <p className="mb-2 text-[11px] text-droid-text-muted">{validation}</p>}
          <button
            type="button"
            onClick={onSave}
            disabled={saving || Boolean(validation)}
            className="ml-auto block rounded-xl bg-droid-text px-4 py-2 text-[13px] font-medium text-droid-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {saving ? 'Saving…' : editor.mode === 'create' ? 'Create automation' : 'Save changes'}
          </button>
        </div>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <h3 className="mb-2 mt-6 text-[12px] font-medium text-droid-text-muted">{children}</h3>;
}
