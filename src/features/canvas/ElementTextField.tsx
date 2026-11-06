// The selected element's text, when one text node is all it holds: typing
// previews it in the guest, Enter commits it (Shift+Enter breaks the line) and
// Escape takes it back.

import { cn } from '../../components/ui/cn';

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
  return (
    <textarea
      aria-label="Text"
      value={value}
      readOnly={disabled}
      rows={1}
      className={cn(
        'field-sizing-content max-h-32 min-h-control-md w-full resize-none rounded-md bg-field px-2.5 py-1.5 text-body text-primary transition-colors duration-150 ease-out hover:bg-active',
        previewed && 'bg-active',
      )}
      onChange={(event) => {
        onPreview(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onCommit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          if (previewed) onRevert();
          else onLeave();
        }
      }}
    />
  );
}
