import { useState } from 'react';

const TONE = {
  add: { sign: '+', color: 'var(--diff-add-fg)' },
  del: { sign: '−', color: 'var(--diff-del-fg)' },
} as const;

// A line count that can grow while an edit streams. Each digit is keyed by its
// place and value, so only the digits that changed remount and fade up; a
// count that never changed since mount renders still, which keeps history calm.
export function ChangeCount({ tone, value }: { tone: keyof typeof TONE; value: number }) {
  const [mountedValue] = useState(value);
  const digits = String(value).split('');
  const enter = value === mountedValue ? undefined : 'count-digit-enter';
  return (
    <span className="shrink-0 text-caption tabular-nums" style={{ color: TONE[tone].color }}>
      {TONE[tone].sign}
      {digits.map((digit, index) => (
        <span key={`${String(digits.length - index)}-${digit}`} className={enter}>
          {digit}
        </span>
      ))}
    </span>
  );
}
