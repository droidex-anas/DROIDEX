// A note of the document (spec §5, §6): a raised card headed by the title its
// file-like label reads as, and its markdown at the reading measure. Edit turns
// it into its label field and a text area.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Pencil } from '@droidex/icons';
import { Markdown } from '../../../components/Markdown';
import { ProseFileLinks } from '../../../components/transcript/ProseFileLink';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { Tooltip } from '../../../components/ui/Tooltip';
import { cn } from '../../../components/ui/cn';
import { pushEscapeLayer } from '../../../components/ui/escapeStack';
import type { DocumentNote } from '../designSystemDocumentProtocol';
import { ActionMenu, type MenuAction } from './ActionMenu';
import type { DraftChange } from './documentDraft';
import { noteTitle, type DraftMark } from './documentSections';
import { UndoRemove, UnsavedMark } from './UnsavedMark';

const NOTE_LABEL = /^[a-z0-9][a-z0-9-]*\.md$/;
const MAX_LABEL_LENGTH = 48;
const MAX_NOTE_BYTES = 8 * 1024;
const utf8 = new TextEncoder();

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
  const [editing, setEditing] = useState(isNew);
  const isRemoved = mark === 'removed';
  const title = noteTitle(note.label);

  const toggle = () => {
    rememberCollapsed(kitId, note.id, expanded);
    setExpanded(!expanded);
  };

  return (
    <article className="rounded-lg bg-raised">
      {/* The header's padding is the body's, so the label starts on the body's
          edge and the chevron or menu ends on it. The unsaved dot hangs outside
          the card, in line with the column's other dots. */}
      <header className="relative flex min-h-11 items-center gap-1.5 px-4">
        <UnsavedMark mark={mark} />
        <button
          type="button"
          aria-expanded={!isRemoved && expanded}
          disabled={isRemoved || editing}
          onClick={toggle}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2.5 text-left text-muted transition-colors duration-quick ease-out enabled:hover:text-secondary disabled:cursor-default"
        >
          <Tooltip label={note.label} className="min-w-0">
            <span
              className={cn(
                'kit-heading-font min-w-0 truncate text-body-strong',
                isRemoved ? 'text-muted line-through' : 'text-primary',
              )}
            >
              {title}
            </span>
          </Tooltip>
          <span className="flex-1" />
          {!isRemoved && !editing && (
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'size-icon-md shrink-0 transition-transform duration-fast ease-smooth-out motion-reduce:transition-none',
                !expanded && '-rotate-90',
              )}
            />
          )}
        </button>
        {onChange &&
          (isRemoved ? (
            <UndoRemove label={title} removedKey={note.id} onChange={onChange} />
          ) : (
            !editing && (
              <ActionMenu
                label={`${title} actions`}
                actions={[
                  {
                    label: 'Edit',
                    icon: Pencil,
                    run: () => {
                      setExpanded(true);
                      setEditing(true);
                    },
                  },
                  ...actions,
                ]}
              />
            )
          ))}
      </header>
      {!isRemoved && editing && onChange && (
        <NoteEditor
          note={note}
          noteLabels={noteLabels}
          onDone={(next) => {
            if (next.label !== note.label || next.body !== note.body)
              onChange({ kind: 'setItem', item: next });
            setEditing(false);
          }}
        />
      )}
      {!isRemoved && !editing && (
        <div className="expand-rows" data-open={expanded || undefined}>
          {/* The row can only shrink below its content when the child both
              hides overflow and allows a zero minimum height. */}
          <div
            inert={!expanded}
            className={cn(
              'min-h-0 overflow-hidden transition-opacity duration-quick ease-out motion-reduce:transition-none',
              !expanded && 'opacity-0',
            )}
          >
            <div className="kit-body-font px-4 pb-4">
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
          </div>
        </div>
      )}
    </article>
  );
}

function NoteEditor({
  note,
  noteLabels,
  onDone,
}: {
  note: DocumentNote;
  noteLabels: ReadonlySet<string>;
  onDone: (note: DocumentNote) => void;
}) {
  const [label, setLabel] = useState(note.label);
  const [body, setBody] = useState(note.body);
  const [problem, setProblem] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<() => void>(() => undefined);

  const done = () => {
    const nextLabel = label.trim();
    const why = labelProblem(nextLabel, note.label, noteLabels) ?? bodyProblem(body);
    if (why !== null) {
      setProblem(why);
      return;
    }
    onDone({ ...note, label: nextLabel, body });
  };
  doneRef.current = done;

  // Escape leaves the editor like Done, so a long note is never lost to a keystroke.
  useEffect(() => {
    const frame = requestAnimationFrame(() => bodyRef.current?.focus());
    const pop = pushEscapeLayer(() => {
      doneRef.current();
    });
    return () => {
      cancelAnimationFrame(frame);
      pop();
    };
  }, []);

  return (
    <div
      onBlur={(event) => {
        // Leaving the editor is Done too, so Save, Discard and ⌘S act on what it shows.
        if (!event.currentTarget.contains(event.relatedTarget)) done();
      }}
      className="flex flex-col gap-2 px-4 pb-4"
    >
      <Input
        variant="compact"
        aria-label="Note label"
        value={label}
        spellCheck={false}
        onChange={(event) => {
          setLabel(event.target.value);
          setProblem(null);
        }}
      />
      <textarea
        ref={bodyRef}
        aria-label={`Text of ${noteTitle(note.label)}`}
        value={body}
        rows={8}
        placeholder="Markdown the agent reads as one of this kit's rules"
        onChange={(event) => {
          setBody(event.target.value);
          setProblem(null);
        }}
        className="min-h-32 w-full resize-y rounded-md bg-field px-3 py-2 text-body text-primary placeholder:text-muted"
      />
      {problem !== null && (
        <p role="alert" className="text-caption text-danger">
          {problem}
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={done}>
          Done
        </Button>
      </div>
    </div>
  );
}

function labelProblem(label: string, current: string, taken: ReadonlySet<string>): string | null {
  if (label.length > MAX_LABEL_LENGTH || !NOTE_LABEL.test(label))
    return 'A note label is a lowercase file name ending in .md, such as 1-rules.md, of at most 48 characters.';
  if (label !== current && taken.has(label)) return `Another note is already called ${label}.`;
  return null;
}

function bodyProblem(body: string): string | null {
  return utf8.encode(body).byteLength > MAX_NOTE_BYTES
    ? 'A note is at most 8 KiB. Shorten it.'
    : null;
}
