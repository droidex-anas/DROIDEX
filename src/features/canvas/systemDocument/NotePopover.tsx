// A usage note in a popover (spec §6), for a token row or a preview. Edits are
// kept when the popover closes; Remove clears the note.

import { useState, type RefObject } from 'react';
import { Trash } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Popover } from '../../../components/ui/Popover';

const utf8 = new TextEncoder();

export function NotePopover({
  anchorRef,
  title,
  note,
  maxBytes,
  onChange,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  title: string;
  note: string | undefined;
  maxBytes: number;
  /** Absent for a kit that cannot be edited. */
  onChange?: (note: string | undefined) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(note ?? '');
  const tooLong = utf8.encode(text).byteLength > maxBytes;

  const close = () => {
    const next = text.trim();
    if (onChange && !tooLong && next !== (note ?? '')) onChange(next === '' ? undefined : next);
    onClose();
  };

  return (
    <Popover
      open
      onClose={close}
      anchorRef={anchorRef}
      label={title}
      width={320}
      placement="bottom-end"
    >
      <div className="flex flex-col gap-2 p-3">
        <p className="truncate text-label text-muted">{title}</p>
        {onChange ? (
          <>
            <textarea
              value={text}
              autoFocus
              rows={4}
              aria-label={title}
              aria-invalid={tooLong || undefined}
              placeholder="When to use it and what it is for"
              onChange={(event) => {
                setText(event.target.value);
              }}
              className="w-full resize-none rounded-md bg-field px-2.5 py-2 text-body text-primary placeholder:text-muted"
            />
            {tooLong && (
              <p className="text-caption text-danger">
                A usage note is at most {maxBytes} bytes. This one is not kept until it is shorter.
              </p>
            )}
            {note !== undefined && (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Trash}
                  onClick={() => {
                    onChange(undefined);
                    onClose();
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="whitespace-pre-wrap text-body text-primary">{note}</p>
        )}
      </div>
    </Popover>
  );
}
