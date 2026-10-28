import { useState } from 'react';

const TONE = {
  add: { sign: '+', color: 'var(--diff-add-fg)' },
  del: { sign: '−', color: 'var(--diff-del-fg)' },
} as const;

function digitsOf(value: number): { key: string; digit: string }[] {
  const digits = String(value).split('');
  return digits.map((digit, index) => ({
    key: `${String(digits.length - index)}-${digit}`,
    digit,
  }));
}

// A line count that can grow while an edit streams. Each digit is keyed by its
// place and value, so a changed digit remounts. Only digits that did not exist
// at mount take the entrance; adding the class to a digit already on screen
// would replay it, and a count that never changed renders still.
export function ChangeCount({ tone, value }: { tone: keyof typeof TONE; value: number }) {
  const [mountedKeys] = useState(() => new Set(digitsOf(value).map((d) => d.key)));
  return (
    <span className="shrink-0 text-caption tabular-nums" style={{ color: TONE[tone].color }}>
      {TONE[tone].sign}
      {digitsOf(value).map(({ key, digit }) => (
        <span key={key} className={mountedKeys.has(key) ? undefined : 'count-digit-enter'}>
          {digit}
        </span>
      ))}
    </span>
  );
}
