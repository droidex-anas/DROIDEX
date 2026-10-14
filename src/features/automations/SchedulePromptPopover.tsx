import { Clock } from '@droidex/icons';
import { X } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { Button } from '../../components/ui/Button';
import { Popover } from '../../components/ui/Popover';
import { ScheduleControls } from './ScheduleControls';
import { AutomationRequestUnconfirmedError } from './client';
import type { AutomationSchedule } from './types';

export default function SchedulePromptPopover({
  anchorRef,
  sessionTitle,
  onSave,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  sessionTitle: string;
  onSave: (runAt: number, timezone: string) => Promise<void>;
  onClose: () => void;
}) {
  const [schedule, setSchedule] = useState<AutomationSchedule>(() => ({
    kind: 'once',
    runAt: nextHour(),
  }));
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [saving, setSaving] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (!saving) onClose();
  };
  const save = async () => {
    if (saving || unconfirmed || schedule.kind !== 'once') return;
    if (schedule.runAt <= Date.now()) {
      setError('Choose a time in the future.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(schedule.runAt, timezone);
      onClose();
    } catch (failure) {
      setUnconfirmed(failure instanceof AutomationRequestUnconfirmedError);
      setError(failure instanceof Error ? failure.message : 'Could not schedule this prompt.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover
      open
      anchorRef={anchorRef}
      onClose={close}
      label="Schedule prompt"
      placement="top-end"
      width={360}
    >
      <form
        className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-start gap-3">
          <Clock className="mt-1 size-icon-md shrink-0 text-secondary" />
          <div className="min-w-0 flex-1">
            <h2 className="text-subheading text-primary">Send later</h2>
            <p className="mt-0.5 truncate text-caption text-muted" title={sessionTitle}>
              Continue in {sessionTitle || 'this conversation'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            aria-label="Close schedule"
            disabled={saving}
            onClick={close}
          />
        </div>

        <fieldset disabled={saving || unconfirmed} className="mt-4 min-w-0">
          <div className="mb-3 flex gap-2">
            {[
              { label: 'In 1 hour', runAt: nextHour },
              { label: 'Tomorrow, 9 AM', runAt: tomorrowMorning },
            ].map((preset) => (
              <Button
                key={preset.label}
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSchedule({ kind: 'once', runAt: preset.runAt() });
                  setError(null);
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="divide-y divide-divider rounded-lg bg-surface/30">
            <ScheduleControls
              schedule={schedule}
              timezone={timezone}
              onChange={(value) => {
                setSchedule(value);
                setError(null);
              }}
            />
          </div>
        </fieldset>
        <p className="mt-2 text-right text-caption text-muted">{timezone.replaceAll('_', ' ')}</p>
        <p className="mt-4 text-caption text-muted">
          Uses this conversation’s settings and permissions. If it is busy, delivery waits. If
          DROIDEX is asleep or closed, it sends when available again.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-caption text-warning">
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-caption text-muted">Manage in Automations</span>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={saving}
            disabled={saving || unconfirmed}
          >
            Schedule prompt
          </Button>
        </div>
      </form>
    </Popover>
  );
}

function nextHour(): number {
  return Math.ceil((Date.now() + 60 * 60 * 1_000) / 60_000) * 60_000;
}

function tomorrowMorning(): number {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}
