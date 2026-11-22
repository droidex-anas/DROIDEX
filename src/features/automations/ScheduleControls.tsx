import { useId, useState, type ReactNode } from 'react';
import { SelectMenu } from './SelectMenu';
import { epochFromZonedInput, WEEKDAYS, zonedInputParts, type ZonedInput } from './schedule';
import {
  AutomationDateInput,
  AutomationMinuteInput,
  AutomationTimeInput,
  clampNumber,
} from './TimeFields';
import type { AutomationSchedule } from '@droidex/protocol';

type InvalidScheduleInput =
  | { kind: 'date'; parts: ZonedInput; text: string }
  | { kind: 'time'; parts: ZonedInput };

export function useInvalidScheduleInput(
  schedule: AutomationSchedule | undefined,
  timezone: string | undefined,
  owner?: string,
) {
  const inputKey = (zone: string | undefined) =>
    JSON.stringify([
      owner,
      schedule?.kind,
      schedule?.kind === 'once' ? schedule.runAt : null,
      zone,
    ]);
  const key = inputKey(timezone);
  const [invalidEdit, setInvalidEdit] = useState<{
    key: string;
    input: InvalidScheduleInput;
  } | null>(null);
  if (invalidEdit && invalidEdit.key !== key) setInvalidEdit(null);
  const invalidInput = invalidEdit?.key === key ? invalidEdit.input : null;
  const setInvalidInput = (input: InvalidScheduleInput | null, zone = timezone) => {
    setInvalidEdit(input ? { key: inputKey(zone), input } : null);
  };
  return [invalidInput, setInvalidInput] as const;
}

export function ScheduleControls({
  schedule,
  timezone,
  onChange,
  invalidInput,
  onInvalidInputChange,
}: {
  schedule: AutomationSchedule;
  timezone: string;
  onChange: (schedule: AutomationSchedule) => void;
  invalidInput: InvalidScheduleInput | null;
  onInvalidInputChange: (input: InvalidScheduleInput | null) => void;
}) {
  const errorId = useId();
  switch (schedule.kind) {
    case 'once': {
      const parts = invalidInput?.parts ?? zonedInputParts(schedule.runAt, timezone);
      const minimumDate = zonedInputParts(Date.now(), timezone);
      const errorMessages = {
        date: 'Enter a valid date as YYYY-MM-DD.',
        time: `This local time does not exist in ${timezone.replaceAll('_', ' ')}. Choose a time outside the daylight-saving gap.`,
      };
      const dateError = invalidInput?.kind === 'date';
      const timeError = invalidInput?.kind === 'time';
      const errors: Partial<Record<InvalidScheduleInput['kind'], ReactNode>> = {};
      if (invalidInput) {
        errors[invalidInput.kind] = (
          <p id={errorId} role="alert" className="px-3.5 py-2 text-caption text-danger">
            {errorMessages[invalidInput.kind]}
          </p>
        );
      }
      const updateInput = (input: ZonedInput) => {
        const runAt = epochFromZonedInput(input, timezone);
        onInvalidInputChange(runAt === null ? { kind: 'time', parts: input } : null);
        if (runAt !== null) onChange({ kind: 'once', runAt });
      };
      return (
        <>
          <EditorRow label="Date">
            <AutomationDateInput
              errorId={invalidInput ? errorId : undefined}
              value={parts}
              minimum={minimumDate}
              invalidText={dateError ? invalidInput.text : undefined}
              onInvalidChange={(text) => {
                if (text !== null) {
                  onInvalidInputChange({ kind: 'date', parts, text });
                } else if (dateError) {
                  updateInput(parts);
                }
              }}
              onChange={(date) => {
                updateInput({ ...parts, ...date });
              }}
            />
          </EditorRow>
          {errors.date}
          <EditorRow label="Time">
            <AutomationTimeInput
              errorId={timeError ? errorId : undefined}
              value={`${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`}
              onChange={(time) => {
                const [hourText = '', minuteText = ''] = time.split(':');
                const input = {
                  ...parts,
                  hour: clampNumber(hourText, 0, 23, parts.hour),
                  minute: clampNumber(minuteText, 0, 59, parts.minute),
                };
                if (dateError) {
                  onInvalidInputChange({ ...invalidInput, parts: input });
                } else {
                  updateInput(input);
                }
              }}
            />
          </EditorRow>
          {errors.time}
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
          <div className="w-52">
            <input
              value={schedule.expression}
              aria-label="Cron expression"
              onChange={(event) => {
                onChange({ kind: 'cron', expression: event.target.value });
              }}
              placeholder="0 9 * * 1-5"
              className="w-full rounded-md bg-field px-2.5 py-1.5 text-right text-label tabular-nums text-primary outline-none transition-colors placeholder:text-muted"
            />
            <div className="mt-1 text-right text-caption text-muted">
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

export function EditorRow({ label, children }: { label: string; children: ReactNode }) {
  const captionId = useId();
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-3.5 py-2 text-body">
      <span id={captionId} className="shrink-0 text-secondary">
        {label}
      </span>
      <div role="group" aria-labelledby={captionId} className="min-w-0 text-right">
        {children}
      </div>
    </div>
  );
}
