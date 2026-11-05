// A token's value as text (spec §5). One number and a unit, such as 12px,
// shows the unit as a quiet suffix; editing changes the number and keeps the
// unit unless another is typed. A reference to another token shows and is
// typed as {name}.

import { cn } from '../../../components/ui/cn';
import type { TokenKind } from '../designSystemDocumentProtocol';
import { cssTokenValue, displayTokenValue, selfReferenceProblem } from './documentSections';
import { InlineField } from './InlineField';
import { tokenValueProblem } from './specimenStyle';
import { splitUnit, withUnit } from './tokenUnit';

export function TokenValue({
  name,
  value,
  kind,
  label,
  isRemoved,
  onDraft,
  onCommit,
}: {
  /** The token's name, which its value may not refer to. */
  name: string;
  value: string;
  kind: TokenKind;
  /** What the value is, such as "Value of space-2". */
  label: string;
  isRemoved: boolean;
  /** Follows the value being edited, then null. */
  onDraft?: (value: string | null) => void;
  /** Null for a value that cannot be edited. */
  onCommit: ((value: string) => void) | null;
}) {
  const shown = displayTokenValue(value);
  const unit = splitUnit(shown);
  if (!onCommit)
    return (
      <span
        className={cn(
          'kit-body-font truncate text-body tabular-nums',
          isRemoved ? 'text-muted line-through' : 'text-secondary',
        )}
      >
        {unit ? unit.number : shown}
        {unit && <span className="ml-0.5 text-muted">{unit.unit}</span>}
      </span>
    );

  const edited = (text: string) => cssTokenValue(unit ? withUnit(text, unit.unit) : text);
  return (
    <InlineField
      value={unit ? unit.number : shown}
      suffix={unit?.unit}
      label={label}
      check={(text) => {
        const css = edited(text);
        return selfReferenceProblem(name, css) ?? tokenValueProblem(kind, css);
      }}
      onDraft={
        onDraft &&
        ((text) => {
          onDraft(text === null ? null : edited(text.trim()));
        })
      }
      onCommit={(text) => {
        const next = edited(text);
        if (next !== value) onCommit(next);
      }}
      className="kit-body-font text-body tabular-nums text-secondary"
    />
  );
}
