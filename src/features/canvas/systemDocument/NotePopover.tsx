// A usage note in a popover (spec §6), for a token row, a preview or an asset.
// The note reads as rendered markdown, whether the kit's agent or the user wrote
// it, and clicking the text edits it in place with the caret where it was
// clicked. Leaving the text, Escape and closing the popover all keep the edit;
// an emptied note is removed.

import { useRef, useState, type RefObject } from 'react';
import { Notebook, PenLine, Trash, X } from '@droidex/icons';
import { Markdown } from '../../../components/Markdown';
import { Button } from '../../../components/ui/Button';
import { Popover } from '../../../components/ui/Popover';
import { Tooltip } from '../../../components/ui/Tooltip';
import { cn } from '../../../components/ui/cn';
import {
  caretPointOf,
  NoteBodyEditor,
  type CaretPoint,
  type NoteBodyEditorHandle,
} from './NoteBodyEditor';

// Wide enough for a short markdown note to read at prose size without
// wrapping every few words.
const WIDTH_PX = 360;

type Mode =
  | { kind: 'reading'; focusEdit: boolean }
  | { kind: 'editing'; caretAt: CaretPoint | null };

export function NotePopover({
  anchorRef,
  title,
  subject,
  note,
  maxBytes,
  onChange,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  /** The kind of note, such as "Usage note". */
  title: string;
  /** What the note is about, such as a token's name. */
  subject: string;
  note: string | undefined;
  maxBytes: number;
  /** Absent for a kit that cannot be edited. */
  onChange?: (note: string | undefined) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>(
    onChange && note === undefined
      ? { kind: 'editing', caretAt: null }
      : { kind: 'reading', focusEdit: false },
  );
  const editorRef = useRef<NoteBodyEditorHandle>(null);
  const label = `${title} of ${subject}`;

  const keep = (text: string, keyboard: boolean) => {
    const next = text.trim() === '' ? undefined : text.trim();
    if (next !== note) onChange?.(next);
    if (next === undefined) onClose();
    else setMode({ kind: 'reading', focusEdit: keyboard });
  };

  // A press outside unmounts the popover before the editor would blur, so an
  // edit in progress is kept here; text over the limit holds the popover open.
  const close = () => {
    if (editorRef.current?.commit() === false) return;
    onClose();
  };

  return (
    <Popover
      open
      onClose={close}
      anchorRef={anchorRef}
      label={label}
      width={WIDTH_PX}
      placement="bottom-end"
    >
      <header className="flex h-10 items-center gap-0.5 pl-4 pr-2">
        <Notebook aria-hidden="true" className="size-icon-md shrink-0 text-muted" />
        <h2 className="ml-1.5 min-w-0 flex-1 truncate text-label text-secondary">{title}</h2>
        {onChange && mode.kind === 'reading' && (
          <Tooltip label="Edit">
            <Button
              variant="ghost"
              size="sm"
              icon={PenLine}
              aria-label={`Edit ${label}`}
              autoFocus={mode.focusEdit}
              onClick={() => {
                setMode({ kind: 'editing', caretAt: null });
              }}
            />
          </Tooltip>
        )}
        {onChange && note !== undefined && (
          <Tooltip label="Remove note">
            <Button
              variant="ghost"
              size="sm"
              icon={Trash}
              aria-label={`Remove ${label}`}
              onClick={() => {
                onChange(undefined);
                onClose();
              }}
            />
          </Tooltip>
        )}
        <Tooltip label="Close">
          <Button variant="ghost" size="sm" icon={X} aria-label="Close" onClick={close} />
        </Tooltip>
      </header>
      <div className="kit-text px-4 pb-4">
        {onChange && mode.kind === 'editing' ? (
          <NoteBodyEditor
            ref={editorRef}
            body={note ?? ''}
            label={label}
            placeholder="When to use it, and when not to"
            maxBytes={maxBytes}
            autoFocus
            caretAt={mode.caretAt}
            className="text-prose text-primary"
            onCommit={keep}
          />
        ) : (
          <div
            onClick={
              onChange
                ? (event) => {
                    const caretAt = caretPointOf(event);
                    if (caretAt) setMode({ kind: 'editing', caretAt });
                  }
                : undefined
            }
            className={cn(onChange && 'cursor-text')}
          >
            {/* A note reads as written, every line break showing, with no
                generated runtimes, images or file controls. */}
            <Markdown authored allowImages={false}>
              {note ?? ''}
            </Markdown>
          </div>
        )}
      </div>
    </Popover>
  );
}
