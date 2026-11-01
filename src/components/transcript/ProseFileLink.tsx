import { createContext, useContext, type ReactNode } from 'react';

import { repoPathInProse } from '../../lib/prosePaths';
import type { OpenReviewFileHandler } from '../../lib/reviewFocus';

// A reply names files constantly ("check `docs/architecture.md`"), and those
// mentions open in Review exactly like a tool row's path. The handler reaches
// them through context because react-markdown's element maps are built once at
// module load and settled replies are cached as rendered elements: passing it
// down as a prop would rebuild both on every streamed token.
const ProseFileContext = createContext<OpenReviewFileHandler | null>(null);

/**
 * Scopes the file mentions inside `children`. Without a handler they stay plain
 * inline code, which is also how a prompt the user typed renders: their own text
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
  if (!path || !onOpenReviewFile) return <code className="inline-code">{children}</code>;
  const open = () => {
    onOpenReviewFile(path);
  };
  // The mention keeps wrapping with the sentence, so the control is the code
  // element itself rather than a button that cannot break a line.
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
      className="inline-code"
    >
      {children}
    </code>
  );
}
