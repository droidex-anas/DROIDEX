import { createContext, useContext, type ReactNode } from 'react';

import { repoPathInProse } from '../../lib/prosePaths';
import type { OpenReviewFileHandler } from '../../lib/reviewFocus';

// Inline code sits in the line as a quiet tone in the `code` style, tinted from
// the text colour so it still reads on a message bubble (`.inline-code`).
const PILL = 'inline-code rounded-sm font-mono text-code text-primary break-words';

// A reply names files constantly ("check `docs/architecture.md`"), and those
// mentions open in Review exactly like a tool row's path. The handler reaches
// them through context because react-markdown's element maps are built once at
// module load and settled replies are cached as rendered elements: passing it
// down as a prop would rebuild both on every streamed token.
const ProseFileContext = createContext<OpenReviewFileHandler | null>(null);

/**
 * Scopes the file mentions inside `children`. Without a handler they stay plain
 * pills, which is also how a prompt the user typed renders: their own text
 * names files they already have open, and a bubble is not a set of controls.
 */
export function ProseFileLinks({
  onOpenReviewFile,
  children,
}: {
  onOpenReviewFile?: OpenReviewFileHandler;
  children: ReactNode;
}) {
  return (
    <ProseFileContext.Provider value={onOpenReviewFile ?? null}>
      {children}
    </ProseFileContext.Provider>
  );
}

export function InlineCode({ children }: { children?: ReactNode }) {
  const onOpenReviewFile = useContext(ProseFileContext);
  const path = typeof children === 'string' ? repoPathInProse(children) : null;
  if (!path || !onOpenReviewFile) return <code className={PILL}>{children}</code>;
  const open = () => {
    onOpenReviewFile(path);
  };
  // The pill stays a pill and keeps wrapping with the sentence, so the control
  // is the code element itself rather than a button that cannot break a line.
  return (
    <code
      role="button"
      tabIndex={0}
      title="Open in Review"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      }}
      // The underline appears on hover rather than fading in from transparent:
      // a selection repaints a transparent decoration in the selection colour.
      className={`${PILL} cursor-pointer underline-offset-2 hover:underline`}
    >
      {children}
    </code>
  );
}
