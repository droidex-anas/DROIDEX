// The selected element's text, when one text node is all it holds: typing
// previews it in the guest, Enter commits it (Shift+Enter breaks the line) and
// Escape takes it back. Text past the preview's cap is cut where it is typed,
// so the guest shows exactly what Enter saves.

import { useId, useState } from 'react';
import { cn } from '../../components/ui/cn';
import { clampPreviewText } from './previewDocument';

export interface ElementTextFieldProps {
  value: string;
  previewed: boolean;
  disabled: boolean;
  onPreview: (value: string) => void;
  onRevert: () => void;
  onCommit: () => void;
  onLeave: () => void;
}

export function ElementTextField({
  value,
  previewed,
  disabled,
  onPreview,
  onRevert,
  onCommit,
  onLeave,
}: ElementTextFieldProps) {
  const hintId = useId();
  /** The text a cut left, so the hint stays only while that text is the one shown. */
  const [cutTo, setCutTo] = useState<string | null>(null);
  const cut = cutTo === value;
  return (
    <div className="flex flex-col gap-1">
      <textarea
        aria-label="Text"
        aria-describedby={cut ? hintId : undefined}
        value={value}
        readOnly={disabled}
        rows={1}
        className={cn(
          'field-sizing-content max-h-32 min-h-control-md w-full resize-none rounded-md bg-field px-2.5 py-1.5 text-body text-primary transition-colors duration-150 ease-out hover:bg-active',
          previewed && 'bg-active',
        )}
        onChange={(event) => {
          const typed = event.target.value;
          const kept = clampPreviewText(typed);
          setCutTo(kept === typed ? null : kept);
          onPreview(kept);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onCommit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            // While saving, the preview is what is being written, so it stays.
            if (previewed && !disabled) onRevert();
            else onLeave();
          }
        }}
      />
      {cut && (
        <p id={hintId} className="text-caption text-muted">
          Text edited here stops at this length. Ask the agent for longer copy.
        </p>
      )}
    </div>
  );
}
