// A note of the document (spec §5, §6): a raised card headed by the title its
// file-like label reads as — the label itself is the title's tooltip — and
// its markdown at the reading measure. The title edits inline, and clicking
// the body edits it in place as live markdown (see NoteBodyEditor).

import { useRef, useState } from 'react';
import { ChevronDown, Pencil } from '@droidex/icons';
import { Markdown } from '../../../components/Markdown';
import { ProseFileLinks } from '../../../components/transcript/ProseFileLink';
import { Tooltip } from '../../../components/ui/Tooltip';
import { cn } from '../../../components/ui/cn';
import type { DocumentNote } from '../designSystemDocumentProtocol';
import { ActionMenu, type MenuAction } from './ActionMenu';
import type { DraftChange } from './documentDraft';
import { noteLabel, noteTitle, type DraftMark } from './documentSections';
import { InlineField, type InlineFieldHandle } from './InlineField';
import { NoteBodyEditor } from './NoteBodyEditor';
import { UndoRemove, UnsavedMark } from './UnsavedMark';

const NOTE_LABEL = /^[a-z0-9][a-z0-9-]*\.md$/;
const MAX_LABEL_LENGTH = 48;

// Collapsed notes by kit, for the app session.
const collapsedNotes = new Map<string, Set<string>>();

function isCollapsed(kitId: string, noteId: string): boolean {
  return collapsedNotes.get(kitId)?.has(noteId) ?? false;
}

function rememberCollapsed(kitId: string, noteId: string, collapsed: boolean) {
  const notes = collapsedNotes.get(kitId) ?? new Set<string>();
  if (collapsed) notes.add(noteId);
  else notes.delete(noteId);
  collapsedNotes.set(kitId, notes);
}

export function NoteCard({
  kitId,
  note,
  mark,
  noteLabels,
  actions,
  isNew,
  onChange,
}: {
  kitId: string;
  note: DocumentNote;
  mark: DraftMark | undefined;
  /** Every note label in the draft, which a renamed note may not take. */
  noteLabels: ReadonlySet<string>;
  /** The note's move and remove actions. */
  actions: MenuAction[];
  isNew: boolean;
  onChange: ((change: DraftChange) => void) | null;
}) {
  const [expanded, setExpanded] = useState(() => !isCollapsed(kitId, note.id));
  const [editingBody, setEditingBody] = useState(isNew);
  const titleRef = useRef<InlineFieldHandle>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const isRemoved = mark === 'removed';
  const title = noteTitle(note.label);
  const canEdit = onChange !== null && !isRemoved;
  const open = expanded || editingBody;

  const toggle = () => {
    rememberCollapsed(kitId, note.id, expanded);
    setExpanded(!expanded);
  };

  const commitTitle = (text: string) => {
    const label = noteLabel(text);
    if (label !== note.label) onChange?.({ kind: 'setItem', item: { ...note, label } });
  };

  const commitBody = (body: string, keyboard: boolean) => {
    if (body !== note.body) onChange?.({ kind: 'setItem', item: { ...note, body } });
    setEditingBody(false);
    // A keyboard exit lands on the card's own control, not the page body.
    if (keyboard) chevronRef.current?.focus();
  };

  const menuActions: MenuAction[] = [
    ...(editingBody
      ? []
      : [
          {
            label: 'Edit',
            icon: Pencil,
            run: () => {
              setExpanded(true);
              setEditingBody(true);
            },
          } satisfies MenuAction,
        ]),
    {
      label: 'Rename',
      run: () => {
        titleRef.current?.edit();
      },
    },
    ...actions,
  ];

  return (
    <article data-item-id={note.id} className="scroll-mt-4 rounded-lg bg-raised">
      {/* The header's padding is the body's, so the title starts on the body's
          edge and the chevron or menu ends on it. The unsaved dot hangs outside
          the card, in line with the column's other dots. */}
      <header className="relative flex min-h-11 items-center gap-1.5 px-4">
        <UnsavedMark mark={mark} />
        {canEdit ? (
          <Tooltip label={note.label} className="min-w-0">
            <InlineField
              ref={titleRef}
              value={title}
              label={`Title of the ${title} note`}
              initiallyEditing={isNew}
              check={(text) => titleProblem(text, note.label, noteLabels)}
              onCommit={commitTitle}
              className="kit-heading-font text-body-strong text-primary"
            />
          </Tooltip>
        ) : (
          <Tooltip label={note.label} className="min-w-0">
            <span
              className={cn(
                'kit-heading-font block min-w-0 truncate py-2.5 text-body-strong',
                isRemoved ? 'text-muted line-through' : 'text-primary',
              )}
            >
              {title}
            </span>
          </Tooltip>
        )}
        <span className="flex-1" />
        {!isRemoved && (
          <button
            ref={chevronRef}
            type="button"
            aria-expanded={open}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            onClick={toggle}
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-quick ease-out hover:bg-elevated hover:text-secondary"
          >
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-icon-md transition-transform duration-fast ease-smooth-out motion-reduce:transition-none',
                !open && '-rotate-90',
              )}
            />
          </button>
        )}
        {onChange &&
          (isRemoved ? (
            <UndoRemove label={title} removedKey={note.id} onChange={onChange} />
          ) : (
            <ActionMenu label={`${title} actions`} actions={menuActions} />
          ))}
      </header>
      {!isRemoved && (
        <div className="expand-rows" data-open={open || undefined}>
          {/* The row can only shrink below its content when the child both
              hides overflow and allows a zero minimum height. */}
          <div
            inert={!open}
            className={cn(
              'min-h-0 overflow-hidden transition-opacity duration-quick ease-out motion-reduce:transition-none',
              !open && 'opacity-0',
            )}
          >
            <div className="kit-body-font px-4 pb-4">
              {editingBody && canEdit ? (
                <NoteBodyEditor
                  body={note.body}
                  label={`Text of ${title}`}
                  autoFocus={!isNew}
                  onCommit={commitBody}
                />
              ) : (
                <div
                  onClick={
                    canEdit
                      ? () => {
                          setExpanded(true);
                          setEditingBody(true);
                        }
                      : undefined
                  }
                  className={cn(canEdit && 'cursor-text')}
                >
                  {note.body.trim() === '' ? (
                    <p className="text-body text-muted">This note is empty.</p>
                  ) : (
                    // Kit text is not the user's prompt: no generated runtimes, no images, no file controls.
                    <ProseFileLinks>
                      <Markdown allowGeneratedContent={false} allowImages={false}>
                        {note.body}
                      </Markdown>
                    </ProseFileLinks>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function titleProblem(title: string, current: string, taken: ReadonlySet<string>): string | null {
  const label = noteLabel(title);
  if (!NOTE_LABEL.test(label)) return 'A title needs at least one letter or digit.';
  if (label.length > MAX_LABEL_LENGTH) return 'That title is too long for a note label.';
  if (label !== current && taken.has(label)) return `Another note is already called ${label}.`;
  return null;
}
