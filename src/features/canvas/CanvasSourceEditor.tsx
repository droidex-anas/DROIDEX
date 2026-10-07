// One file's text, edited in place: a transparent textarea laid over the shared
// code layer (CanvasSourceCode.tsx), so the caret and the selection are the
// platform's and the colour comes from the one shared code theme. Lines never
// wrap, which is what keeps the gutter, the highlight and the caret on the same
// line as the build's diagnostics.

import { useEffect, useRef } from 'react';
import { INPUT_METRICS, LINE_HEIGHT, SourceCode, SourceScroller } from './CanvasSourceCode';
import type { SourceIssue } from './canvasSourceIssues';

interface CanvasSourceEditorProps {
  path: string;
  text: string;
  /** This file's build issues, keyed by the 1-based line they name. */
  issues: Map<number, SourceIssue[]>;
  /** A line to reveal and put the caret on, bumped by the issue list. */
  reveal: { line: number; nonce: number } | null;
  onChange: (text: string) => void;
  /** Cmd/Ctrl+S from inside the editor. */
  onSave: () => void;
}

export function CanvasSourceEditor({
  path,
  text,
  issues,
  reveal,
  onChange,
  onSave,
}: CanvasSourceEditorProps) {
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const field = input.current;
    if (!reveal || !field) return;
    const offset = lineOffset(field.value, reveal.line);
    field.focus();
    field.setSelectionRange(offset, offset);
    scrollerOf(field)?.scrollTo({ top: Math.max(0, (reveal.line - 3) * LINE_HEIGHT) });
  }, [reveal]);

  return (
    <SourceScroller>
      <SourceCode path={path} text={text} issues={issues}>
        <textarea
          ref={input}
          value={text}
          wrap="off"
          spellCheck={false}
          aria-label={`${path} source`}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          // The textarea must never scroll on its own or it would slide out
          // from under the highlight; the caret moves the one scroller both
          // layers live in instead.
          onScroll={(event) => {
            const field = event.currentTarget;
            const scroller = scrollerOf(field);
            if (scroller) {
              scroller.scrollLeft += field.scrollLeft;
              scroller.scrollTop += field.scrollTop;
            }
            field.scrollLeft = 0;
            field.scrollTop = 0;
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              // The drawer listens for this key too. One keystroke is one Save,
              // so the field that handled it keeps it.
              event.stopPropagation();
              onSave();
              return;
            }
            if (event.key === 'Tab' && !event.shiftKey) {
              event.preventDefault();
              insertIndent(event.currentTarget, onChange);
            }
          }}
          style={{ lineHeight: `${String(LINE_HEIGHT)}px`, tabSize: 2 }}
          className={`absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre break-normal bg-transparent text-transparent caret-droid-text outline-none selection:bg-droid-accent/25 ${INPUT_METRICS}`}
        />
      </SourceCode>
    </SourceScroller>
  );
}

/** The one element both layers scroll inside. */
function scrollerOf(field: HTMLTextAreaElement): Element | null {
  return field.closest('[data-source-scroller]');
}

/** The offset of a 1-based line's first character. */
function lineOffset(text: string, line: number): number {
  let offset = 0;
  for (let at = 1; at < line; at += 1) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
}

/** Tab indents instead of leaving the editor, because this is a code field. */
function insertIndent(field: HTMLTextAreaElement, onChange: (text: string) => void): void {
  const { selectionStart, selectionEnd, value } = field;
  onChange(`${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`);
  requestAnimationFrame(() => {
    field.setSelectionRange(selectionStart + 2, selectionStart + 2);
  });
}
