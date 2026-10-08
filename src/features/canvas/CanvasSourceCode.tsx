// One file's text, coloured in theme tokens and measured to the pixel. The
// editor lays a transparent textarea over this so the caret and the selection
// stay the platform's; the conflict view shows the same thing on its own, with
// nothing to type into. They share the metrics here because a line that is 19px
// in one and 19.2px in the other slides the caret off its own highlight.

import { useMemo, type ReactNode } from 'react';
import { Highlight } from 'prism-react-renderer';
import { CODE_THEME, HIGHLIGHT_CHAR_LIMIT } from '../../lib/codeTheme';
import { resolveFilePresentation } from '../../lib/filePresentation';
import type { SourceIssue } from './canvasSourceIssues';

export const LINE_HEIGHT = 19;
const TEXT_METRICS = 'font-mono text-[12px]';
// Both layers take the same box; only the gutter's own left rail differs.
const PADDING = 'py-2.5 pr-4';
const GUTTER_PADDING = 'py-2.5 px-3';

/** The one element a file's layers scroll inside, so they scroll together. */
export function SourceScroller({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div
      data-source-scroller
      tabIndex={label ? 0 : undefined}
      role={label ? 'region' : undefined}
      aria-label={label}
      className="scrollbar-on-hover min-h-0 flex-1 overflow-auto rounded-xl bg-droid-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-droid-accent/15"
    >
      <div className="flex min-h-full w-max min-w-full">{children}</div>
    </div>
  );
}

/**
 * The gutter and the coloured text of one file. `children` is the input layer
 * the editor puts over it; the conflict view passes none.
 */
export function SourceCode({
  path,
  text,
  issues,
  children,
}: {
  path: string;
  text: string;
  /** This file's build issues, keyed by the 1-based line they name. */
  issues: Map<number, SourceIssue[]>;
  children?: ReactNode;
}) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const language = resolveFilePresentation(path).language;
  return (
    <>
      <div
        aria-hidden
        className={`sticky left-0 z-10 shrink-0 select-none bg-droid-surface text-right text-droid-text-muted/60 ${TEXT_METRICS} ${GUTTER_PADDING}`}
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
              <CodeLayer hidden={children !== undefined}>
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
          <CodeLayer hidden={children !== undefined}>
            {lines.map((line, index) => (
              <CodeLine key={index} faulted={issues.has(index + 1)}>
                {line}
              </CodeLine>
            ))}
          </CodeLayer>
        )}
        {children}
      </div>
    </>
  );
}

/** Hide decorative editor backing; standalone comparison text stays accessible. */
function CodeLayer({ children, hidden }: { children: ReactNode; hidden: boolean }) {
  return (
    <pre
      aria-hidden={hidden}
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
    <div style={{ height: LINE_HEIGHT }} className={faulted ? 'bg-droid-red/10' : undefined}>
      {children}
    </div>
  );
}

/** The exact metrics the editor's own input layer has to match. */
export const INPUT_METRICS = `${TEXT_METRICS} ${PADDING}`;
