// A token's value as text (spec §5). One number and a unit, such as 12px,
// shows the unit as a quiet suffix; editing changes the number and keeps the
// unit unless another is typed.

import type { ReactNode } from 'react';
import { cn } from '../../../components/ui/cn';
import type { TokenKind } from '../designSystemDocumentProtocol';
import { InlineField } from './InlineField';
import { tokenValueProblem } from './specimenStyle';
import { splitUnit, withUnit } from './tokenUnit';

export function TokenValue({
  value,
  kind,
  label,
  isRemoved,
  leading,
  onCommit,
}: {
  value: string;
  kind: TokenKind;
  /** What the value is, such as "Value of space-2". */
  label: string;
  isRemoved: boolean;
  leading?: (text: string) => ReactNode;
  /** Null for a value that cannot be edited. */
  onCommit: ((value: string) => void) | null;
}) {
  const unit = splitUnit(value);
  if (!onCommit)
    return (
      <span
        className={cn(
          'kit-body-font truncate text-body tabular-nums',
          isRemoved ? 'text-muted line-through' : 'text-secondary',
        )}
      >
        {unit ? unit.number : value}
        {unit && <span className="ml-0.5 text-muted">{unit.unit}</span>}
      </span>
    );

  const edited = (text: string) => (unit ? withUnit(text, unit.unit) : text);
  return (
    <InlineField
      value={unit ? unit.number : value}
      suffix={unit?.unit}
      label={label}
      check={(text) => tokenValueProblem(kind, edited(text))}
      leading={leading}
      onCommit={(text) => {
        const next = edited(text);
        if (next !== value) onCommit(next);
      }}
      className="kit-body-font text-body tabular-nums text-secondary"
    />
  );
}
