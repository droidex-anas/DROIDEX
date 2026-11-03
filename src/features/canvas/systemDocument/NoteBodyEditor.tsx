// A note's body, edited in place (spec §6): the live markdown the composer
// writes in, growing with the text, with no Done button — leaving the field
// or ⌘Enter keeps the text, and Escape keeps it too, so a note is never lost
// to a keystroke. Over its limit the text stays open with why.

import { useEffect, useImperativeHandle, useRef, useState, type MouseEvent, type Ref } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { insertNewline } from '@codemirror/commands';
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { liveMarkdown } from '../../../components/composer/liveMarkdown';
import { markdownStyles } from '../../../components/composer/liveMarkdownTheme';
import { pushEscapeLayer } from '../../../components/ui/escapeStack';
import { noteFieldLayout } from './noteFieldLayout';

const utf8 = new TextEncoder();

// The field grows with the note instead of scrolling, and inherits the type
// around it, so the text keeps its place when the rendered note becomes the editor.
const noteField = EditorView.theme({
  '&': { fontSize: 'inherit' },
  '.cm-scroller': { overflow: 'visible', lineHeight: 'inherit' },
  '.cm-content': { padding: '0' },
  '.cm-line': { padding: '0' },
});

/** A viewport point in the rendered note, where the caret goes once it is the editor. */
export interface CaretPoint {
  x: number;
  y: number;
}

/**
 * Where a click on a rendered note puts the caret, or null when the click is
 * not asking to edit: it opened a link, or ended a selection made to copy.
 */
export function caretPointOf(event: MouseEvent): CaretPoint | null {
  if (event.target instanceof Element && event.target.closest('a')) return null;
  if (window.getSelection()?.isCollapsed === false) return null;
  return { x: event.clientX, y: event.clientY };
}

export interface NoteBodyEditorHandle {
  /** Keeps the text being edited; false while it is over the limit, which stays open. */
  commit: () => boolean;
}

export function NoteBodyEditor({
  ref,
  body,
  label,
  placeholder,
  maxBytes,
  autoFocus,
  caretAt = null,
  className,
  onCommit,
}: {
  ref?: Ref<NoteBodyEditorHandle>;
  body: string;
  /** The field's accessible name, such as "Text of Rules". */
  label: string;
  placeholder: string;
  maxBytes: number;
  autoFocus: boolean;
  /** Where a focused editor puts its caret; the end of the text when absent. */
  caretAt?: CaretPoint | null;
  /** The frame around the field and its problem line. */
  className?: string;
  /** Keeps the text; `keyboard` when ⌘Enter or Escape asked, so focus can return. */
  onCommit: (body: string, keyboard: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const commitRef = useRef<(keyboard: boolean) => boolean>(() => true);
  const viewRef = useRef<EditorView | null>(null);
  const labelCompartment = useRef(new Compartment());

  useImperativeHandle(ref, () => ({ commit: () => commitRef.current(false) }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Escape keeps the text like any other exit, but only while the field has
    // focus: a title being edited above it owns Escape then.
    let popEscape: (() => void) | null = null;
    // The editor settles once, on kept text or at teardown. Destroying a focused
    // view blurs it, and so does the focus a keyboard exit moves to the card;
    // neither blur is the user leaving the field.
    let isSettled = false;
    const view = new EditorView({
      state: EditorState.create({
        doc: body,
        extensions: [
          liveMarkdown([noteField, markdownStyles]),
          noteFieldLayout,
          EditorView.lineWrapping,
          cmPlaceholder(placeholder),
          labelCompartment.current.of(labelAttribute(label)),
          EditorView.contentAttributes.of({ 'aria-multiline': 'true', spellcheck: 'true' }),
          keymap.of([
            {
              key: 'Enter',
              run: (editor) => insertNewlineContinueMarkup(editor) || insertNewline(editor),
            },
            {
              key: 'Mod-Enter',
              run: () => {
                commitRef.current(true);
                return true;
              },
            },
          ]),
          EditorView.domEventHandlers({
            focus: () => {
              popEscape = pushEscapeLayer(() => {
                commitRef.current(true);
              });
            },
            blur: () => {
              if (isSettled) return;
              popEscape?.();
              popEscape = null;
              commitRef.current(false);
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setProblem(null);
          }),
        ],
      }),
      parent: host,
    });
    commitRef.current = (keyboard) => {
      if (isSettled) return true;
      const text = view.state.doc.toString();
      const bytes = utf8.encode(text).byteLength;
      if (bytes > maxBytes) {
        setProblem(
          `This note is ${String(bytes - maxBytes)} bytes over its ${size(maxBytes)} limit.`,
        );
        return false;
      }
      isSettled = true;
      onCommitRef.current(text, keyboard);
      return true;
    };
    viewRef.current = view;
    if (autoFocus) {
      view.focus();
      const at = caretAt ? view.posAtCoords(caretAt) : null;
      view.dispatch({ selection: { anchor: at ?? view.state.doc.length } });
    }
    return () => {
      isSettled = true;
      viewRef.current = null;
      popEscape?.();
      view.destroy();
    };
    // The editor owns its text while mounted; a changed note body remounts the card's editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  // A renamed note keeps the text being edited; only the field's name follows.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: labelCompartment.current.reconfigure(labelAttribute(label)),
    });
  }, [label]);

  return (
    <div className={className}>
      <div ref={hostRef} className="kit-note-field" />
      {problem !== null && (
        <p role="alert" className="pt-1 text-caption text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

function labelAttribute(label: string) {
  return EditorView.contentAttributes.of({ 'aria-label': label });
}

function size(bytes: number): string {
  return bytes % 1024 === 0 ? `${String(bytes / 1024)} KiB` : `${String(bytes)}-byte`;
}
