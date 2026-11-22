import { useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from '../../lib/toast';
import { buildScheduledPromptDraft, type ScheduledPromptDraft } from './buildScheduledPromptDraft';

interface ComposerScheduleSave {
  draft: ScheduledPromptDraft;
  whenReady: () => Promise<string[]>;
  resetIfUntouched: () => void;
  settle: () => void;
}

export function useComposerPromptSchedule({
  target,
  visibleTargetKey,
  visibleTargetKeyRef,
  beginSave,
}: {
  target: { appSessionId: string } | null;
  visibleTargetKey: string;
  visibleTargetKeyRef: RefObject<string>;
  beginSave: () => ComposerScheduleSave;
}) {
  const [scheduleTarget, setScheduleTarget] = useState<{ appSessionId: string } | null>(null);
  const scheduleGeneration = useRef(0);

  useEffect(() => {
    // Switching abandons the schedule; the generation stops an in-flight save resetting the new draft.
    setScheduleTarget(null);
    return () => {
      scheduleGeneration.current += 1;
    };
  }, [visibleTargetKey]);

  const save = async (runAt: number, timezone: string) => {
    if (!target) throw new Error('Open the conversation you want to continue.');
    const scheduledAppSessionId = target.appSessionId;
    const scheduledTargetKey = visibleTargetKey;
    const generation = scheduleGeneration.current;
    const transaction = beginSave();
    // The key changes at commit, before target-switch passive effects run.
    const stillTargeted = () =>
      scheduleGeneration.current === generation &&
      visibleTargetKeyRef.current === scheduledTargetKey;
    try {
      const [paths, client, schedules] = await Promise.all([
        transaction.whenReady(),
        import('../../features/automations/client'),
        import('../../features/automations/schedule'),
      ]);
      if (!stillTargeted()) throw new Error('The conversation changed. Nothing was scheduled.');
      await client.createAutomation(
        buildScheduledPromptDraft({
          draft: transaction.draft,
          paths,
          appSessionId: scheduledAppSessionId,
          runAt,
          timezone,
          defaults: schedules.defaultAutomationDraft(null, null, null),
        }),
      );
      if (stillTargeted()) transaction.resetIfUntouched();
      toast.success('Prompt scheduled.');
    } finally {
      transaction.settle();
    }
  };

  return {
    scheduleTarget,
    open: () => {
      setScheduleTarget(target);
    },
    close: () => {
      setScheduleTarget((current) => (current === scheduleTarget ? null : current));
    },
    save,
  };
}
