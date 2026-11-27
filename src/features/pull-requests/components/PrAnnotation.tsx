import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil, Trash } from '@droidex/icons';

import { CompactComposer } from '../../../components/composer/CompactComposer';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import type { DiffLineTarget } from '../../../components/environment/DiffBody';
import { diffLineAnchorKey, type DiffLineSide } from '../../../lib/unifiedDiff';
import type { PrComment } from '../../../types/vcs';
import type { PrLineAnnotation } from '../lib/prAnnotations';
import { PrInlineComment } from './PrInlineComment';

const MAX_HEIGHT = 160;

// What the inline editor is annotating: the line, and whether it edits an
// existing note or drafts a new one.
export interface PrAnnotationEditingState {
  path: string;
  target: DiffLineTarget;
  annotationId: string | null;
}

// The inline note editor, anchored under the diff line it annotates: the same
// small composer as design mode's quick prompt. Enter saves, Shift+Enter adds
// a line, Escape backs out, and focus leaving an empty editor closes it.
function PrAnnotationEditor({
  initialBody,
  line,
  submitLabel,
  onSave,
  onCancel,
}: {
  initialBody: string;
  line: number;
  submitLabel: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initialBody);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);

  return (
    <div
      className="pr-note-enter"
      onBlur={(event) => {
        if (body.trim() || event.currentTarget.contains(event.relatedTarget)) return;
        onCancel();
      }}
    >
      <CompactComposer
        textareaRef={textareaRef}
        value={body}
        onChange={setBody}
        onSend={() => {
          onSave(body);
        }}
        onEscape={onCancel}
        canSend={body.trim().length > 0}
        placeholder={`Add a note on line ${String(line)}`}
        label={`Note on line ${String(line)}`}
        sendLabel={submitLabel}
        maxHeight={MAX_HEIGHT}
      />
    </div>
  );
}

// A saved annotation, right under the line it is on. The note belongs to the
// reader, not the pull request, so there is no byline: just the prose.
function PrAnnotationCard({
  annotation,
  onEdit,
  onRemove,
}: {
  annotation: PrLineAnnotation;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-start gap-2 rounded-xl bg-elevated py-1.5 pr-1.5 pl-3.5">
      <p className="min-w-0 flex-1 py-1 text-body whitespace-pre-wrap text-primary">
        {annotation.body}
      </p>
      {/* Hover-revealed, but the space is reserved so the note never reflows. */}
      <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-quick pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <Tooltip label="Edit note">
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            aria-label={`Edit note on line ${String(annotation.line)}`}
            onClick={onEdit}
          />
        </Tooltip>
        <Tooltip label="Delete note">
          <Button
            variant="ghost"
            size="sm"
            icon={Trash}
            aria-label={`Delete note on line ${String(annotation.line)}`}
            onClick={onRemove}
          />
        </Tooltip>
      </span>
    </div>
  );
}

function isCommentAtLine(comment: PrComment, side: DiffLineSide, line: number): boolean {
  return comment.line === line && (comment.side === 'LEFT' ? 'old' : 'new') === side;
}

function isNoteAtLine(note: PrLineAnnotation, side: DiffLineSide, line: number): boolean {
  return diffLineAnchorKey(note.side, note.line) === diffLineAnchorKey(side, line);
}

function isEditingAtLine(
  editing: PrAnnotationEditingState | null,
  path: string,
  side: DiffLineSide,
  line: number,
): editing is PrAnnotationEditingState {
  return (
    editing?.path === path &&
    diffLineAnchorKey(editing.target.side, editing.target.line) === diffLineAnchorKey(side, line)
  );
}

// The content anchored under one line: GitHub's inline comments first (they
// were there first), then the reader's own notes, the open editor last.
export function PrAnchoredContent({
  side,
  line,
  path,
  annotations,
  comments,
  editing,
  onEditNote,
  onRemoveNote,
  onSaveEditor,
  onCancelEditor,
}: {
  side: DiffLineSide;
  line: number;
  path: string;
  annotations: PrLineAnnotation[];
  comments: PrComment[];
  editing: PrAnnotationEditingState | null;
  onEditNote: (note: PrLineAnnotation) => void;
  onRemoveNote: (id: string) => void;
  onSaveEditor: (state: PrAnnotationEditingState, body: string) => void;
  onCancelEditor: (state: PrAnnotationEditingState) => void;
}) {
  const pieces: ReactNode[] = [];
  for (const comment of comments) {
    if (!isCommentAtLine(comment, side, line)) continue;
    pieces.push(<PrInlineComment key={`c-${comment.id}`} comment={comment} />);
  }
  for (const note of annotations) {
    if (!isNoteAtLine(note, side, line)) continue;
    if (editing?.annotationId === note.id) continue;
    pieces.push(
      <PrAnnotationCard
        key={`n-${note.id}`}
        annotation={note}
        onEdit={() => {
          onEditNote(note);
        }}
        onRemove={() => {
          onRemoveNote(note.id);
        }}
      />,
    );
  }
  if (isEditingAtLine(editing, path, side, line)) {
    const existing = editing.annotationId
      ? annotations.find((note) => note.id === editing.annotationId)
      : null;
    pieces.push(
      <PrAnnotationEditor
        key="editor"
        line={editing.target.line}
        initialBody={existing?.body ?? ''}
        submitLabel={editing.annotationId ? 'Save note' : 'Add note'}
        onSave={(body) => {
          onSaveEditor(editing, body);
        }}
        onCancel={() => {
          onCancelEditor(editing);
        }}
      />,
    );
  }
  if (pieces.length === 0) return null;
  return <div className="space-y-1.5">{pieces}</div>;
}
