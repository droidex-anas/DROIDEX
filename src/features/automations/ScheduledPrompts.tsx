import { useMemo, useState } from 'react';
import { Clock, Pencil, X } from '@droidex/icons';
import { PendingPromptPreview } from '../../components/composer/PendingPromptPreview';
import { Button } from '../../components/ui/Button';
import { useStoreDispatch } from '../../hooks/useStore';
import { toast } from '../../lib/toast';
import { setAutomationEnabled, useAutomationSnapshot } from './client';
import { formatSchedule, isAutomationRunActive, latestRunsByAutomation } from './schedule';

const VISIBLE_PROMPTS = 3;

export default function ScheduledPrompts({ appSessionId }: { appSessionId: string }) {
  const dispatch = useStoreDispatch();
  const snapshot = useAutomationSnapshot();
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const prompts = useMemo(() => {
    const latestRuns = latestRunsByAutomation(snapshot.runs);
    return snapshot.automations
      .filter(
        (automation) =>
          automation.target.kind === 'existing-session' &&
          automation.target.appSessionId === appSessionId,
      )
      .map((automation) => ({
        automation,
        status: latestRuns.get(automation.id)?.status ?? automation.lastRunStatus,
      }))
      .filter(
        ({ automation, status }) =>
          automation.enabled || isAutomationRunActive(status === null ? undefined : { status }),
      )
      .sort(
        (left, right) =>
          (left.automation.nextRunAt ?? left.automation.lastRunAt ?? 0) -
            (right.automation.nextRunAt ?? right.automation.lastRunAt ?? 0) ||
          left.automation.id.localeCompare(right.automation.id),
      );
  }, [snapshot.automations, snapshot.runs, appSessionId]);

  if (prompts.length === 0) return null;

  const cancel = async (id: string) => {
    if (cancelingId !== null) return;
    setCancelingId(id);
    try {
      await setAutomationEnabled(id, false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not cancel the scheduled prompt.',
      );
    } finally {
      setCancelingId(null);
    }
  };

  return (
    <section aria-label="Scheduled prompts" className="mb-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 px-1 text-label text-muted">
        <Clock className="size-icon-sm" />
        Scheduled · sends to this conversation
      </div>
      {prompts.slice(0, VISIBLE_PROMPTS).map(({ automation, status }) => {
        const delivering = status === 'starting' || status === 'running';
        const canceling = cancelingId === automation.id;
        let hint: string;
        if (delivering) hint = 'Delivering…';
        else if (status === 'queued') hint = 'Waiting for this conversation to be ready';
        else hint = formatSchedule(automation.schedule, automation.timezone);
        return (
          <div
            key={automation.id}
            className="group flex items-start gap-2 rounded-lg bg-elevated px-2 py-1.5 transition-colors"
          >
            <Clock className="mt-0.5 size-icon-sm shrink-0 text-muted/60" />
            <PendingPromptPreview text={automation.prompt} files={automation.files}>
              <span aria-live="polite" className="mt-1 block text-caption text-muted">
                {hint}
              </span>
            </PendingPromptPreview>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                icon={Pencil}
                title="Edit in Automations"
                aria-label="Edit scheduled prompt"
                disabled={cancelingId !== null}
                onClick={() => {
                  dispatch({ type: 'OPEN_AUTOMATIONS', automationId: automation.id });
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                loading={canceling}
                title={
                  delivering
                    ? 'Cancel pending delivery; requests already sent cannot be retracted'
                    : 'Cancel scheduled prompt'
                }
                aria-label="Cancel scheduled prompt"
                disabled={cancelingId !== null}
                onClick={() => void cancel(automation.id)}
              />
            </div>
          </div>
        );
      })}
      {prompts.length > VISIBLE_PROMPTS && (
        <button
          type="button"
          onClick={() => {
            dispatch({ type: 'OPEN_AUTOMATIONS' });
          }}
          className="rounded-xs px-1 text-left text-caption text-muted transition-colors hover:text-primary"
        >
          {prompts.length - VISIBLE_PROMPTS} more in Automations
        </button>
      )}
    </section>
  );
}
