// One file's text, edited in place. The app already colours code with Prism in
// theme tokens (the files pane preview reads the same theme), so this is a
// transparent textarea laid over that highlight: the caret and the selection
// are the platform's, and the colour comes from the one shared code theme.
// Lines never wrap, which is what keeps the gutter, the highlight and the
// caret on the same line as the build's diagnostics.

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Highlight } from 'prism-react-renderer';
import { CODE_THEME, HIGHLIGHT_CHAR_LIMIT } from '../../lib/codeTheme';
import { resolveFilePresentation } from '../../lib/filePresentation';
import type { SourceIssue } from './canvasSourceState';

interface CanvasSourceEditorProps {
  path: string;
  text: string;
  /** This file's build issues, keyed by the 1-based line they name. */
  issues: Map<number, SourceIssue[]>;
  /** A line to reveal and put the caret on, bumped by the issue list. */
  reveal: { line: number; nonce: number } | null;
  readOnly: boolean;
  onChange: (text: string) => void;
  /** Cmd/Ctrl+S from inside the editor. */
  onSave: () => void;
}

// Exact pixel metrics, shared by the highlight and the textarea: an em-based
// line height would round differently in the two and drift the overlay.
const LINE_HEIGHT = 19;
const TEXT_METRICS = 'font-mono text-[12px]';
const PADDING = 'py-2.5 pr-4';

export function CanvasSourceEditor({
  path,
  text,
  issues,
  reveal,
  readOnly,
  onChange,
  onSave,
}: CanvasSourceEditorProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const lines = useMemo(() => text.split('\n'), [text]);
  const language = resolveFilePresentation(path).language;

  useEffect(() => {
    const field = input.current;
    if (!reveal || !field) return;
    const offset = lineOffset(field.value, reveal.line);
    field.focus();
    field.setSelectionRange(offset, offset);
    scrollerOf(field)?.scrollTo({ top: Math.max(0, (reveal.line - 3) * LINE_HEIGHT) });
  }, [reveal]);

  return (
    <div
      data-source-scroller
      className="scrollbar-on-hover min-h-0 flex-1 overflow-auto rounded-xl bg-droid-surface"
    >
      <div className="flex min-h-full w-max min-w-full">
        <div
          aria-hidden
          className={`sticky left-0 z-10 shrink-0 select-none bg-droid-surface pl-3 pr-3 text-right text-droid-text-muted/60 ${TEXT_METRICS} ${PADDING}`}
        >
          {lines.map((_, index) => (
            <div
              key={index}
              style={{ height: LINE_HEIGHT, lineHeight: `${String(LINE_HEIGHT)}px` }}
              className={issues.has(index + 1) ? 'text-droid-red' : undefined}
            >
              {index + 1}
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {language && text.length <= HIGHLIGHT_CHAR_LIMIT ? (
            <Highlight theme={CODE_THEME} code={text} language={language}>
              {({ tokens, getLineProps, getTokenProps }) => (
                <CodeLayer>
                  {tokens.map((line, index) => (
                    <CodeLine key={index} faulted={issues.has(index + 1)}>
                      <span {...getLineProps({ line })}>
                        {line.map((token, at) => (
                          <span {...getTokenProps({ token })} key={at} />
                        ))}
                      </span>
                    </CodeLine>
                  ))}
                </CodeLayer>
              )}
            </Highlight>
          ) : (
            <CodeLayer>
              {lines.map((line, index) => (
                <CodeLine key={index} faulted={issues.has(index + 1)}>
                  {line}
                </CodeLine>
              ))}
            </CodeLayer>
          )}
          <textarea
            ref={input}
            value={text}
            readOnly={readOnly}
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
                onSave();
                return;
              }
              if (event.key === 'Tab' && !event.shiftKey) {
                event.preventDefault();
                insertIndent(event.currentTarget, onChange);
              }
            }}
            style={{ lineHeight: `${String(LINE_HEIGHT)}px`, tabSize: 2 }}
            className={`absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre break-normal bg-transparent text-transparent caret-droid-text outline-none selection:bg-droid-accent/25 ${TEXT_METRICS} ${PADDING}`}
          />
        </div>
      </div>
    </div>
  );
}

/** The coloured text under the caret: it measures the editor and never takes input. */
function CodeLayer({ children }: { children: ReactNode }) {
  return (
    <pre
      aria-hidden
      style={{ lineHeight: `${String(LINE_HEIGHT)}px`, tabSize: 2 }}
      className={`m-0 whitespace-pre text-droid-text-secondary ${TEXT_METRICS} ${PADDING}`}
    >
      {children}
    </pre>
  );
}

/** One line, tinted when the build reported something on it. */
function CodeLine({ faulted, children }: { faulted: boolean; children: ReactNode }) {
  return (
    <div style={{ height: LINE_HEIGHT }} className={faulted ? 'bg-droid-red/[0.08]' : undefined}>
      {children}
    </div>
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
