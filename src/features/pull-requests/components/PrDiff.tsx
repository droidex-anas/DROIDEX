import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, WrapText } from 'lucide-react';

import { DiffFileSection } from '../../../components/environment/DiffFileSection';
import type { DiffLineReview, DiffLineTarget } from '../../../components/environment/DiffBody';
import { FileTypeIcon } from '../../../components/FileTypeIcon';
import { useStoreSelector } from '../../../hooks/useStore';
import type { FileDiffEntry } from '../../../hooks/useReviewFileDiffs';
import { diffLineAnchorKey, type DiffLineSide } from '../../../lib/unifiedDiff';
import type { DiffFile, PrComment } from '../../../types/vcs';
import { usePrReviewDraft } from '../hooks/usePrReviewDraft';
import type { PrLineAnnotation } from '../lib/prAnnotations';
import { splitPrPatch, type PrPatchFile } from '../lib/prPatch';
import { PrAnnotationCard, PrAnnotationEditor } from './PrAnnotation';
import { PrInlineComment } from './PrInlineComment';
import { PrReviewBar } from './PrReviewBar';

const AUTO_EXPAND_MAX = 25;

// What the inline editor is annotating: the line, and whether it edits an
// existing note or drafts a new one.
interface EditingState {
  path: string;
  target: DiffLineTarget;
  annotationId: string | null;
}

function FileRow({
  file,
  selected,
  viewed,
  onSelect,
  onToggleViewed,
}: {
  file: DiffFile;
  selected: boolean;
  viewed: boolean;
  onSelect: (path: string) => void;
  onToggleViewed: (path: string) => void;
}) {
  const slash = file.path.lastIndexOf('/');
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;
  return (
    <div
      className={`group flex w-full items-center transition-colors ${
        selected ? 'bg-active' : 'hover:bg-elevated/50'
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={viewed}
        aria-label={`Mark ${file.path} as ${viewed ? 'unreviewed' : 'reviewed'}`}
        title={viewed ? 'Mark as unreviewed' : 'Mark as reviewed'}
        onClick={() => {
          onToggleViewed(file.path);
        }}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:text-primary"
      >
        <span
          className={`flex size-4 items-center justify-center rounded transition-colors duration-quick ${
            viewed ? 'bg-accent text-bg' : 'bg-elevated group-hover:bg-active'
          }`}
        >
          {viewed ? <Check size={11} strokeWidth={3} /> : null}
        </span>
      </button>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => {
          onSelect(file.path);
        }}
        title={file.path}
        className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2.5 text-left transition-opacity ${
          viewed ? 'opacity-55' : ''
        }`}
      >
        <FileTypeIcon filename={file.path} className="h-3.5 w-3.5" />
        <span className="min-w-0 flex-1 truncate text-body">
          {dir ? <span className="text-muted/70">{dir}</span> : null}
          <span className="text-primary">{name}</span>
        </span>
        <span className="shrink-0 text-caption tabular-nums">
          {file.additions > 0 ? (
            <span style={{ color: 'var(--diff-add-fg)' }}>+{file.additions}</span>
          ) : null}{' '}
          {file.deletions > 0 ? (
            <span style={{ color: 'var(--diff-del-fg)' }}>−{file.deletions}</span>
          ) : null}
        </span>
      </button>
    </div>
  );
}

// The content anchored under one line: GitHub's inline comments first (they
// were there first), then the reader's own notes, the open editor last.
function AnchoredContent({
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
  editing: EditingState | null;
  onEditNote: (note: PrLineAnnotation) => void;
  onRemoveNote: (id: string) => void;
  onSaveEditor: (state: EditingState, body: string) => void;
  onCancelEditor: (state: EditingState) => void;
}) {
  const pieces: ReactNode[] = [];
  if (side === 'new') {
    for (const comment of comments) {
      if (comment.line !== line) continue;
      pieces.push(<PrInlineComment key={`c-${comment.id}`} comment={comment} />);
    }
  }
  for (const note of annotations) {
    if (diffLineAnchorKey(note.side, note.line) !== diffLineAnchorKey(side, line)) continue;
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
  if (
    editing?.path === path &&
    diffLineAnchorKey(editing.target.side, editing.target.line) === diffLineAnchorKey(side, line)
  ) {
    const existing = editing.annotationId
      ? annotations.find((note) => note.id === editing.annotationId)
      : null;
    pieces.push(
      <PrAnnotationEditor
        key="editor"
        line={editing.target.line}
        initialBody={existing?.body ?? ''}
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

export function PrDiff({
  diff,
  cwd,
  number,
  comments,
  onSendReview,
}: {
  diff: string;
  cwd: string;
  number: number;
  comments: PrComment[];
  onSendReview: (annotations: PrLineAnnotation[]) => void;
}) {
  const diffView = useStoreSelector((state) => state.diffView);
  // Entries are built in the same memo as the parse, so the DiffFileSection
  // memo holds across poll ticks: nothing downstream re-renders on identity.
  const files = useMemo(
    () =>
      splitPrPatch(diff).map((item): PrPatchFile & { entry: FileDiffEntry } => ({
        ...item,
        entry: {
          diff: item.diff,
          status: 'loaded',
          loading: false,
          binary: item.file.binary,
        },
      })),
    [diff],
  );
  const { draft, addNote, updateNote, removeNote, clearNotes, toggleViewed } = usePrReviewDraft(
    cwd,
    number,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [wrap, setWrap] = useState(false);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    setExpanded(
      files.length > 0 && files.length <= AUTO_EXPAND_MAX
        ? new Set(files.map((item) => item.file.path))
        : new Set(),
    );
    setActivePath(files[0]?.file.path ?? null);
    setEditing(null);
  }, [files]);

  const registerSection = useCallback((path: string, el: HTMLDivElement | null) => {
    if (el) sectionRefs.current.set(path, el);
    else sectionRefs.current.delete(path);
  }, []);

  const toggle = useCallback((path: string) => {
    setActivePath(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const jumpTo = useCallback((path: string) => {
    setActivePath(path);
    setExpanded((current) => (current.has(path) ? current : new Set(current).add(path)));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        sectionRefs.current.get(path)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    });
  }, []);

  // Closing the editor returns focus to the annotate button of its line, the
  // control that opened it — Escape backs out to where the keyboard user was.
  const closeEditor = useCallback((state: EditingState | null) => {
    setEditing(null);
    if (!state) return;
    requestAnimationFrame(() => {
      const key = diffLineAnchorKey(state.target.side, state.target.line);
      const section = sectionRefs.current.get(state.path);
      const button = section?.querySelector(`[data-diff-line="${key}"]`);
      if (button instanceof HTMLElement) button.focus();
    });
  }, []);

  const saveEditor = useCallback(
    (state: EditingState, body: string) => {
      if (state.annotationId) updateNote(state.annotationId, body);
      else addNote({ ...state.target, path: state.path }, body);
      closeEditor(null);
    },
    [addNote, updateNote, closeEditor],
  );

  // One line-review wiring per file, memoized as a unit. The poll's arrays
  // are structurally shared when unchanged, so an idle tick never rebuilds
  // the row stream underneath thousands of memoized diff lines.
  const lineReviews = useMemo(() => {
    const map = new Map<string, DiffLineReview>();
    for (const item of files) {
      const path = item.file.path;
      // The API numbers inline comments on the new side of the diff; outdated
      // ones keep their place in the timeline instead of anchoring wrong.
      const fileComments = comments.filter(
        (comment) =>
          comment.kind === 'inline' &&
          comment.path === path &&
          comment.line != null &&
          comment.outdated !== true,
      );
      const fileNotes = draft.annotations.filter((note) => note.path === path);
      const editingHere = editing?.path === path ? editing : null;
      if (fileComments.length === 0 && fileNotes.length === 0 && !editingHere) continue;

      const anchors = new Set<string>();
      for (const comment of fileComments) {
        if (comment.line != null) anchors.add(diffLineAnchorKey('new', comment.line));
      }
      for (const note of fileNotes) anchors.add(diffLineAnchorKey(note.side, note.line));
      if (editingHere) {
        anchors.add(diffLineAnchorKey(editingHere.target.side, editingHere.target.line));
      }

      map.set(path, {
        anchors,
        onAnnotate: (target) => {
          setEditing({ path, target, annotationId: null });
        },
        renderBelow: (side, line) => (
          <AnchoredContent
            side={side}
            line={line}
            path={path}
            annotations={fileNotes}
            comments={fileComments}
            editing={editingHere}
            onEditNote={(note) => {
              setEditing({
                path,
                target: { side: note.side, line: note.line, type: 'ctx', text: note.code },
                annotationId: note.id,
              });
            }}
            onRemoveNote={removeNote}
            onSaveEditor={saveEditor}
            onCancelEditor={closeEditor}
          />
        ),
      });
    }
    return map;
  }, [files, comments, draft.annotations, editing, removeNote, saveEditor, closeEditor]);

  const noteCount = draft.annotations.length;
  const viewedCount = draft.viewedFiles.filter((path) =>
    files.some((item) => item.file.path === path),
  ).length;

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <p className="text-body text-muted">No file changes.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Changed files"
        className="pr-workspace-scroll flex w-56 shrink-0 flex-col overflow-y-auto py-1"
      >
        <div className="flex items-center gap-1 px-2.5 pt-1 pb-1.5">
          <span className="min-w-0 flex-1 truncate text-caption text-muted">
            {files.length} {files.length === 1 ? 'file' : 'files'}
            {viewedCount > 0 ? ` · ${String(viewedCount)} reviewed` : ''}
          </span>
          <button
            type="button"
            aria-pressed={wrap}
            title={wrap ? 'Scroll long lines' : 'Wrap long lines'}
            aria-label={wrap ? 'Scroll long lines' : 'Wrap long lines'}
            onClick={() => {
              setWrap((value) => !value);
            }}
            className={`flex size-6 items-center justify-center rounded-md transition-colors ${
              wrap ? 'bg-active text-primary' : 'text-muted hover:bg-elevated hover:text-secondary'
            }`}
          >
            <WrapText size={13} />
          </button>
        </div>
        {files.map((item) => (
          <FileRow
            key={item.file.path}
            file={item.file}
            selected={activePath === item.file.path}
            viewed={draft.viewedFiles.includes(item.file.path)}
            onSelect={jumpTo}
            onToggleViewed={toggleViewed}
          />
        ))}
      </nav>
      <div className="relative min-h-0 min-w-0 flex-1">
        <div className="pr-workspace-scroll h-full overflow-auto pb-24">
          {files.map((item) => (
            <DiffFileSection
              key={item.file.path}
              file={item.file}
              open={expanded.has(item.file.path)}
              active={activePath === item.file.path}
              entry={item.entry}
              view={diffView}
              wrap={wrap}
              onToggle={toggle}
              onSectionRef={registerSection}
              lineReview={lineReviews.get(item.file.path)}
              parsed={item.parsed}
            />
          ))}
        </div>
        {noteCount > 0 ? (
          <PrReviewBar
            count={noteCount}
            onSend={() => {
              onSendReview(draft.annotations);
            }}
            onClear={clearNotes}
          />
        ) : null}
      </div>
    </div>
  );
}
