import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { PanelRight, WrapText } from '@droidex/icons';

import { DiffFileSection } from '../../../components/environment/DiffFileSection';
import type { DiffLineReview, DiffLineTarget } from '../../../components/environment/DiffBody';
import { Button } from '../../../components/ui/Button';
import { useStoreSelector } from '../../../hooks/useStore';
import type { FileDiffEntry } from '../../../hooks/useReviewFileDiffs';
import { diffLineAnchorKey, type DiffLineSide } from '../../../lib/unifiedDiff';
import type { PrComment } from '../../../types/vcs';
import { usePrReviewDraft } from '../hooks/usePrReviewDraft';
import type { PrLineAnnotation } from '../lib/prAnnotations';
import { splitPrPatch, type PrPatchFile } from '../lib/prPatch';
import { PrAnchoredContent, type PrAnnotationEditingState } from './PrAnnotation';
import { PR_FILE_TREE_ID, PrFileTree } from './PrFileTree';
import { PrReviewBar } from './PrReviewBar';

const AUTO_EXPAND_MAX = 25;

type PrDiffFileEntry = PrPatchFile & { entry: FileDiffEntry };

// The API numbers LEFT-side comments in the old file and everything else in
// the new one; threads predating the side field default to the new side.
function commentSide(comment: PrComment): DiffLineSide {
  return comment.side === 'LEFT' ? 'old' : 'new';
}

function sameArrayItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function inlineCommentsForPath(comments: readonly PrComment[], path: string): PrComment[] {
  return comments.filter(
    (comment) =>
      comment.kind === 'inline' &&
      comment.path === path &&
      comment.line != null &&
      comment.outdated !== true,
  );
}

function annotationsForPath(
  annotations: readonly PrLineAnnotation[],
  path: string,
): PrLineAnnotation[] {
  return annotations.filter((note) => note.path === path);
}

function editingForPath(
  editing: PrAnnotationEditingState | null,
  path: string,
): PrAnnotationEditingState | null {
  return editing?.path === path ? editing : null;
}

const PrDiffFile = memo(
  function PrDiffFile({
    item,
    comments,
    annotations,
    editing,
    open,
    active,
    view,
    wrap,
    onToggle,
    onSectionRef,
    onOpenEditor,
    onRemoveNote,
    onSaveEditor,
    onCancelEditor,
  }: {
    item: PrDiffFileEntry;
    comments: PrComment[];
    annotations: PrLineAnnotation[];
    editing: PrAnnotationEditingState | null;
    open: boolean;
    active: boolean;
    view: 'unified' | 'split';
    wrap: boolean;
    onToggle: (path: string) => void;
    onSectionRef: (path: string, el: HTMLDivElement | null) => void;
    onOpenEditor: (path: string, target: DiffLineTarget, annotationId: string | null) => void;
    onRemoveNote: (id: string) => void;
    onSaveEditor: (state: PrAnnotationEditingState, body: string) => void;
    onCancelEditor: (state: PrAnnotationEditingState) => void;
  }) {
    const path = item.file.path;
    // The API numbers inline comments on the new side of the diff; outdated
    // ones keep their place in the timeline instead of anchoring wrong.
    const fileComments = useMemo(() => inlineCommentsForPath(comments, path), [comments, path]);
    const fileNotes = useMemo(() => annotationsForPath(annotations, path), [annotations, path]);
    const editingHere = editing?.path === path ? editing : null;

    const onAnnotate = useCallback(
      (target: DiffLineTarget) => {
        // A line that already carries a note opens that note for editing
        // instead of a blank editor that would silently replace it.
        const existing = fileNotes.find(
          (note) =>
            diffLineAnchorKey(note.side, note.line) === diffLineAnchorKey(target.side, target.line),
        );
        onOpenEditor(path, target, existing?.id ?? null);
      },
      [fileNotes, onOpenEditor, path],
    );

    const anchors = useMemo(() => {
      const keys = new Set<string>();
      for (const comment of fileComments) {
        if (comment.line != null) keys.add(diffLineAnchorKey(commentSide(comment), comment.line));
      }
      for (const note of fileNotes) keys.add(diffLineAnchorKey(note.side, note.line));
      if (editingHere) {
        keys.add(diffLineAnchorKey(editingHere.target.side, editingHere.target.line));
      }
      return keys;
    }, [fileComments, fileNotes, editingHere]);

    const onEditNote = useCallback(
      (note: PrLineAnnotation) => {
        onOpenEditor(path, { side: note.side, line: note.line, text: note.code }, note.id);
      },
      [onOpenEditor, path],
    );

    const renderBelow = useCallback(
      (side: DiffLineSide, line: number) => (
        <PrAnchoredContent
          side={side}
          line={line}
          path={path}
          annotations={fileNotes}
          comments={fileComments}
          editing={editingHere}
          onEditNote={onEditNote}
          onRemoveNote={onRemoveNote}
          onSaveEditor={onSaveEditor}
          onCancelEditor={onCancelEditor}
        />
      ),
      [
        path,
        fileNotes,
        fileComments,
        editingHere,
        onEditNote,
        onRemoveNote,
        onSaveEditor,
        onCancelEditor,
      ],
    );

    const lineReview = useMemo(
      (): DiffLineReview => ({ onAnnotate, anchors, renderBelow }),
      [onAnnotate, anchors, renderBelow],
    );

    return (
      <DiffFileSection
        file={item.file}
        open={open}
        active={active}
        entry={item.entry}
        view={view}
        wrap={wrap}
        onToggle={onToggle}
        onSectionRef={onSectionRef}
        lineReview={lineReview}
        parsed={item.parsed}
      />
    );
  },
  (prev, next) => {
    const path = prev.item.file.path;
    return (
      prev.item === next.item &&
      prev.open === next.open &&
      prev.active === next.active &&
      prev.view === next.view &&
      prev.wrap === next.wrap &&
      prev.onToggle === next.onToggle &&
      prev.onSectionRef === next.onSectionRef &&
      prev.onOpenEditor === next.onOpenEditor &&
      prev.onRemoveNote === next.onRemoveNote &&
      prev.onSaveEditor === next.onSaveEditor &&
      prev.onCancelEditor === next.onCancelEditor &&
      editingForPath(prev.editing, path) === editingForPath(next.editing, path) &&
      sameArrayItems(
        inlineCommentsForPath(prev.comments, path),
        inlineCommentsForPath(next.comments, path),
      ) &&
      sameArrayItems(
        annotationsForPath(prev.annotations, path),
        annotationsForPath(next.annotations, path),
      )
    );
  },
);

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
  const files = useMemo<PrDiffFileEntry[]>(
    () =>
      splitPrPatch(diff).map((item) => ({
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
  const diffFiles = useMemo(() => files.map((item) => item.file), [files]);
  const { draft, addNote, updateNote, removeNote, clearNotes, toggleViewed } = usePrReviewDraft(
    cwd,
    number,
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string | null>(null);
  const [editing, setEditing] = useState<PrAnnotationEditingState | null>(null);
  const [wrap, setWrap] = useState(false);
  const [treeVisible, setTreeVisible] = useState(true);
  // The tree's filter and folds live here, not in the tree: hiding the panel
  // unmounts it for the exit animation, and reopening must return the reader
  // to the tree they had. A new pull request still starts them fresh.
  const [treeFilter, setTreeFilter] = useState('');
  const [treeCollapsed, setTreeCollapsed] = useState<Set<string>>(() => new Set());
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    setExpanded(
      files.length > 0 && files.length <= AUTO_EXPAND_MAX
        ? new Set(files.map((item) => item.file.path))
        : new Set(),
    );
    setActivePath(files[0]?.file.path ?? null);
    setEditing(null);
  }, [files, cwd, number]);

  // Unlike the diff sections, the tree's filter and folds stay valid when a
  // poll refresh rewrites the diff: they name paths, not content. Only moving
  // to another pull request starts them fresh.
  useEffect(() => {
    setTreeFilter('');
    setTreeCollapsed(new Set());
  }, [cwd, number]);

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

  const openEditor = useCallback(
    (path: string, target: DiffLineTarget, annotationId: string | null) => {
      setEditing({ path, target, annotationId });
    },
    [],
  );

  // Closing the editor returns focus to the annotate button of its line, the
  // control that opened it — Escape backs out to where the keyboard user was.
  const closeEditor = useCallback((state: PrAnnotationEditingState | null) => {
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
    (state: PrAnnotationEditingState, body: string) => {
      if (state.annotationId) updateNote(state.annotationId, body);
      else addNote({ ...state.target, path: state.path }, body);
      closeEditor(state);
    },
    [addNote, updateNote, closeEditor],
  );

  const noteCount = draft.annotations.length;
  const viewedFileSet = useMemo(() => new Set(draft.viewedFiles), [draft.viewedFiles]);
  const viewedCount = draft.viewedFiles.filter((path) =>
    files.some((item) => item.file.path === path),
  ).length;
  const totals = useMemo(
    () =>
      files.reduce(
        (count, item) => ({
          additions: count.additions + item.file.additions,
          deletions: count.deletions + item.file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <p className="text-body text-muted">No file changes.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 select-none items-center gap-3 px-4">
        <span className="min-w-0 truncate text-caption text-muted">
          {files.length} {files.length === 1 ? 'file' : 'files'}
          {viewedCount > 0 ? ` · ${String(viewedCount)} reviewed` : ''}
        </span>
        <span className="shrink-0 text-caption tabular-nums">
          {totals.additions > 0 ? (
            <span style={{ color: 'var(--diff-add-fg)' }}>+{totals.additions}</span>
          ) : null}
          {totals.additions > 0 && totals.deletions > 0 ? ' ' : null}
          {totals.deletions > 0 ? (
            <span style={{ color: 'var(--diff-del-fg)' }}>−{totals.deletions}</span>
          ) : null}
        </span>
        <div className="min-w-0 flex-1" />
        <Button
          variant="ghost"
          size="sm"
          icon={WrapText}
          aria-pressed={wrap}
          title={wrap ? 'Scroll long lines' : 'Wrap long lines'}
          aria-label={wrap ? 'Scroll long lines' : 'Wrap long lines'}
          onClick={() => {
            setWrap((value) => !value);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={PanelRight}
          aria-expanded={treeVisible}
          aria-controls={PR_FILE_TREE_ID}
          onClick={() => {
            setTreeVisible((visible) => !visible);
          }}
        >
          {treeVisible ? 'Hide file tree' : 'Show file tree'}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 min-w-0 flex-1">
          <div className="pr-workspace-scroll h-full overflow-auto pb-24">
            {files.map((item) => (
              <PrDiffFile
                key={item.file.path}
                item={item}
                comments={comments}
                annotations={draft.annotations}
                editing={editing}
                open={expanded.has(item.file.path)}
                active={activePath === item.file.path}
                view={diffView}
                wrap={wrap}
                onToggle={toggle}
                onSectionRef={registerSection}
                onOpenEditor={openEditor}
                onRemoveNote={removeNote}
                onSaveEditor={saveEditor}
                onCancelEditor={closeEditor}
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
        <AnimatePresence initial={false}>
          {treeVisible ? (
            <PrFileTree
              key={`${cwd}#${String(number)}`}
              files={diffFiles}
              activePath={activePath}
              viewedFiles={viewedFileSet}
              filter={treeFilter}
              collapsedDirectories={treeCollapsed}
              onFilterChange={setTreeFilter}
              onCollapsedDirectoriesChange={setTreeCollapsed}
              onSelect={jumpTo}
              onToggleViewed={toggleViewed}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
