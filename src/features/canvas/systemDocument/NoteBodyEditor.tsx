// A note's body, edited in place (spec §6): the live markdown the composer
// writes in, growing with the text, with no Done button — leaving the field
// or ⌘Enter keeps the text, and Escape keeps it too, so a note is never lost
// to a keystroke. Over 8 KiB the text stays open with why.

import { useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { insertNewline } from '@codemirror/commands';
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { liveMarkdown } from '../../../components/composer/liveMarkdown';
import { markdownStyles } from '../../../components/composer/liveMarkdownTheme';
import { pushEscapeLayer } from '../../../components/ui/escapeStack';

const MAX_NOTE_BYTES = 8 * 1024;
const utf8 = new TextEncoder();

// The field grows with the note instead of scrolling, and inherits the card's
// type; the container tints while it has focus.
const noteField = EditorView.theme({
  '&': { fontSize: 'inherit' },
  '.cm-scroller': { overflow: 'visible', lineHeight: 'inherit' },
  '.cm-content': { padding: '2px 0' },
});

export function NoteBodyEditor({
  body,
  label,
  autoFocus,
  onCommit,
}: {
  body: string;
  /** The field's accessible name, such as "Text of Rules". */
  label: string;
  autoFocus: boolean;
  /** Keeps the text; `keyboard` when ⌘Enter or Escape asked, so focus can return. */
  onCommit: (body: string, keyboard: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const commitRef: { current: (keyboard: boolean) => void } = {
      current: () => undefined,
    };
    // Escape keeps the text like any other exit, but only while the field has
    // focus: a title being edited above it owns Escape then.
    let popEscape: (() => void) | null = null;
    // Destroying a focused view (a remount, or the unmount a commit just asked
    // for) blurs it; that blur is teardown, not the user leaving the field.
    let alive = true;
    const view = new EditorView({
      state: EditorState.create({
        doc: body,
        extensions: [
          liveMarkdown([noteField, markdownStyles]),
          EditorView.lineWrapping,
          cmPlaceholder("Markdown the agent reads as one of this kit's rules"),
          EditorView.contentAttributes.of({
            'aria-label': label,
            'aria-multiline': 'true',
            spellcheck: 'true',
          }),
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
              if (!alive) return;
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
      const text = view.state.doc.toString();
      if (utf8.encode(text).byteLength > MAX_NOTE_BYTES) {
        setProblem('A note is at most 8 KiB. Shorten it.');
        return;
      }
      onCommitRef.current(text, keyboard);
    };
    if (autoFocus) view.focus();
    return () => {
      alive = false;
      popEscape?.();
      view.destroy();
    };
    // The editor owns its text while mounted; a changed note body remounts the card's editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, label]);

  return (
    <div className="-mx-2 rounded-md px-2 py-1 transition-colors duration-quick ease-out focus-within:bg-elevated">
      <div ref={hostRef} />
      {problem !== null && (
        <p role="alert" className="pb-1 text-caption text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
