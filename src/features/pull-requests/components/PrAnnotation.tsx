import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import { Button } from '../../../components/ui/Button';
import type { PrLineAnnotation } from '../lib/prAnnotations';

const MAX_HEIGHT = 160;

// The inline note editor, anchored under the diff line it annotates. Escape
// backs out without saving, Cmd/Ctrl+Enter saves — the same contract as the
// comment composer.
export function PrAnnotationEditor({
  initialBody,
  line,
  onSave,
  onCancel,
}: {
  initialBody: string;
  line: number;
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
    <div className="pr-note-enter rounded-lg bg-raised shadow-sm">
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
        className="w-full resize-none bg-transparent px-3 pt-2.5 text-body text-primary outline-none placeholder:text-muted"
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <span className="min-w-0 flex-1 truncate px-1 text-caption text-muted">
          Line {line} · ⌘⏎ to save · esc to cancel
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={save} disabled={!body.trim()}>
          Add note
        </Button>
      </div>
    </div>
  );
}

// A saved annotation. The note belongs to the reader, not the pull request,
// so there is no byline: just the text, with edit and delete on hover.
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
    <div className="group relative rounded-lg bg-elevated/70 px-3 py-2">
      <p className="pr-14 text-body whitespace-pre-wrap text-primary">{annotation.body}</p>
      <span className="absolute top-1 right-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-quick group-hover:opacity-100 group-focus-within:opacity-100">
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
