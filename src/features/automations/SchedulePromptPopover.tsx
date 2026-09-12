import { Clock, Spinner } from '@droidex/icons';
import { X } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { AnchoredPopover } from './AnchoredPopover';
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
    <AnchoredPopover
      open
      anchorRef={anchorRef}
      onClose={close}
      ariaLabel="Schedule prompt"
      width={360}
      maximumHeight={520}
    >
      <form
        className="max-h-[inherit] overflow-y-auto p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="flex items-start gap-3">
          <Clock className="mt-1 h-4 w-4 shrink-0 text-droid-text-secondary" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-medium text-droid-text">Send later</h2>
            <p className="mt-0.5 truncate text-[11px] text-droid-text-muted" title={sessionTitle}>
              Continue in {sessionTitle || 'this conversation'}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label="Close schedule"
            className="rounded-lg p-1.5 text-droid-text-muted hover:bg-droid-surface focus-visible:outline focus-visible:outline-droid-border-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <fieldset disabled={saving || unconfirmed} className="mt-4 min-w-0">
          <div className="mb-3 flex gap-2">
            {[
              { label: 'In 1 hour', runAt: nextHour },
              { label: 'Tomorrow, 9 AM', runAt: tomorrowMorning },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setSchedule({ kind: 'once', runAt: preset.runAt() });
                  setError(null);
                }}
                className="rounded-lg border border-droid-border px-2.5 py-1.5 text-[11px] text-droid-text-secondary transition-colors hover:bg-droid-surface focus-visible:outline focus-visible:outline-droid-border-hover"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="rounded-xl border border-droid-border bg-droid-surface/30">
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
        <p className="mt-2 text-right text-[10.5px] text-droid-text-muted">
          {timezone.replaceAll('_', ' ')}
        </p>
        <p className="mt-4 text-[11px] leading-[17px] text-droid-text-muted">
          Uses this conversation’s settings and permissions. If it is busy, delivery waits. If
          DROIDEX is asleep or closed, it sends when available again.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-[11px] leading-4 text-droid-orange">
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-[10.5px] text-droid-text-muted">Manage in Automations</span>
          <button
            type="submit"
            disabled={saving || unconfirmed}
            className="inline-flex items-center gap-2 rounded-lg bg-droid-text px-3 py-2 text-[12px] font-medium text-droid-bg transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Spinner className="h-3 w-3 motion-safe:animate-spin-slow" />}
            {saving ? 'Scheduling…' : 'Schedule prompt'}
          </button>
        </div>
      </form>
    </AnchoredPopover>
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
