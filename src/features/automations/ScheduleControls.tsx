import { useId, type ReactNode } from 'react';
import { SelectMenu } from './SelectMenu';
import { epochFromZonedInput, WEEKDAYS, zonedInputParts } from './schedule';
import {
  AutomationDateInput,
  AutomationMinuteInput,
  AutomationTimeInput,
  clampNumber,
} from './TimeFields';
import type { AutomationSchedule } from './types';

export function ScheduleControls({
  schedule,
  timezone,
  onChange,
}: {
  schedule: AutomationSchedule;
  timezone: string;
  onChange: (schedule: AutomationSchedule) => void;
}) {
  switch (schedule.kind) {
    case 'once': {
      const parts = zonedInputParts(schedule.runAt, timezone);
      const minimumDate = zonedInputParts(Date.now(), timezone);
      return (
        <>
          <EditorRow label="Date">
            <AutomationDateInput
              value={parts}
              minimum={minimumDate}
              onChange={(date) => {
                const runAt = epochFromZonedInput({ ...parts, ...date }, timezone);
                if (runAt !== null) onChange({ kind: 'once', runAt });
              }}
            />
          </EditorRow>
          <EditorRow label="Time">
            <AutomationTimeInput
              value={`${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`}
              onChange={(time) => {
                const [hourText = '', minuteText = ''] = time.split(':');
                const runAt = epochFromZonedInput(
                  {
                    ...parts,
                    hour: clampNumber(hourText, 0, 23, parts.hour),
                    minute: clampNumber(minuteText, 0, 59, parts.minute),
                  },
                  timezone,
                );
                if (runAt !== null) onChange({ kind: 'once', runAt });
              }}
            />
          </EditorRow>
        </>
      );
    }
    case 'hourly':
      return (
        <EditorRow label="At">
          <AutomationMinuteInput
            value={schedule.minute}
            onChange={(minute) => {
              onChange({ kind: 'hourly', minute });
            }}
          />
        </EditorRow>
      );
    case 'daily':
    case 'weekdays':
      return (
        <EditorRow label="At">
          <AutomationTimeInput
            value={schedule.time}
            onChange={(time) => {
              onChange({ kind: schedule.kind, time });
            }}
          />
        </EditorRow>
      );
    case 'weekly':
      return (
        <>
          <EditorRow label="On">
            <SelectMenu
              value={String(schedule.weekday)}
              ariaLabel="Automation weekday"
              onChange={(value) => {
                onChange({ ...schedule, weekday: Number(value) });
              }}
              options={WEEKDAYS.map((weekday, index) => ({
                value: String(index),
                label: weekday,
              }))}
            />
          </EditorRow>
          <EditorRow label="At">
            <AutomationTimeInput
              value={schedule.time}
              onChange={(time) => {
                onChange({ ...schedule, time });
              }}
            />
          </EditorRow>
        </>
      );
    case 'cron':
      return (
        <EditorRow label="Expression">
          <div className="w-[215px]">
            <input
              value={schedule.expression}
              aria-label="Cron expression"
              onChange={(event) => {
                onChange({ kind: 'cron', expression: event.target.value });
              }}
              placeholder="0 9 * * 1-5"
              className="w-full rounded-lg border border-droid-border bg-droid-bg/70 px-2.5 py-1.5 text-right text-[12px] tabular-nums text-droid-text outline-none transition-colors placeholder:text-droid-text-muted focus:border-droid-border-hover"
            />
            <div className="mt-1 text-right text-[11px] text-droid-text-muted">
              minute · hour · day · month · weekday
            </div>
          </div>
        </EditorRow>
      );
  }
}

export function scheduleForKind(kind: string, current: AutomationSchedule): AutomationSchedule {
  const time = 'time' in current ? current.time : '09:00';
  switch (kind) {
    case 'once':
      return { kind: 'once', runAt: Date.now() + 60 * 60 * 1_000 };
    case 'hourly':
      return { kind: 'hourly', minute: 0 };
    case 'weekdays':
      return { kind: 'weekdays', time };
    case 'weekly':
      return { kind: 'weekly', weekday: 1, time };
    case 'cron':
      return { kind: 'cron', expression: '0 9 * * 1-5' };
    default:
      return { kind: 'daily', time };
  }
}

export function EditorRow({
  label,
  children,
  last = false,
}: {
  label: string;
  children: ReactNode;
  last?: boolean;
}) {
  const captionId = useId();
  return (
    <div
      className={`flex min-h-12 items-center justify-between gap-4 px-3.5 py-2 text-[13px] ${
        last ? '' : 'border-b border-droid-border/70'
      }`}
    >
      <span id={captionId} className="shrink-0 text-droid-text-secondary">
        {label}
      </span>
      <div role="group" aria-labelledby={captionId} className="min-w-0 text-right">
        {children}
      </div>
    </div>
  );
}
