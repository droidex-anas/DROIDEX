import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { Button } from '../../../components/ui/Button';
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

function CodeContext({ line, code }: { line: number; code: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-caption text-muted">Line {line}</span>
      {code.length > 0 ? (
        <code
          title={code}
          className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-pre font-mono text-code-sm text-secondary"
        >
          {code}
        </code>
      ) : null}
    </div>
  );
}

// The inline note editor, anchored under the diff line it annotates. Escape
// backs out without saving, Cmd/Ctrl+Enter saves — the same contract as the
// comment composer.
export function PrAnnotationEditor({
  initialBody,
  line,
  code,
  submitLabel,
  onSave,
  onCancel,
}: {
  initialBody: string;
  line: number;
  code: string;
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

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${String(Math.min(node.scrollHeight, MAX_HEIGHT))}px`;
  }, [body]);

  const save = () => {
    if (!body.trim()) return;
    onSave(body);
  };

  return (
    <div className="pr-note-enter overflow-hidden rounded-lg bg-raised shadow-sm">
      <div className="px-3 pt-2">
        <CodeContext line={line} code={code} />
      </div>
      <textarea
        ref={textareaRef}
        value={body}
        rows={1}
        aria-label={`Note on line ${String(line)}`}
        placeholder="Add a note on this line"
        spellCheck
        onChange={(event) => {
          setBody(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            save();
          }
        }}
        className="mt-1 w-full resize-none overflow-y-auto bg-transparent px-3 py-1.5 font-sans text-body text-primary outline-none placeholder:text-muted"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <span className="min-w-0 flex-1 truncate px-1 text-caption text-muted">
          ⌘⏎ to save · esc to cancel
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={save} disabled={!body.trim()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

// A saved annotation. The note belongs to the reader, not the pull request,
// so there is no byline: the annotated line, then the prose in the UI font.
export function PrAnnotationCard({
  annotation,
  onEdit,
  onRemove,
}: {
  annotation: PrLineAnnotation;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="group flex items-start gap-2 rounded-lg bg-elevated px-3 py-2">
      <div className="min-w-0 flex-1">
        <CodeContext line={annotation.line} code={annotation.code} />
        <p className="pt-1 text-body whitespace-pre-wrap text-primary">{annotation.body}</p>
      </div>
      <span className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity duration-quick pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
        <Button
          variant="ghost"
          size="sm"
          icon={Pencil}
          aria-label={`Edit note on line ${String(annotation.line)}`}
          title="Edit note"
          onClick={onEdit}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={Trash2}
          aria-label={`Delete note on line ${String(annotation.line)}`}
          title="Delete note"
          onClick={onRemove}
        />
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
        code={editing.target.text}
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
