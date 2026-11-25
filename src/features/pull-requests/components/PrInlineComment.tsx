import { useMemo } from 'react';

import { Octicon } from '../../../components/environment/GithubIcons';
import { Badge } from '../../../components/ui/Badge';
import { openExternal } from '../../../lib/onboarding';
import type { PrComment } from '../../../types/vcs';
import { prCommentBlocks } from '../lib/prCommentBody';
import { displayLogin } from '../lib/prIdentity';
import { prAbsoluteTime, prRelativeTime } from '../lib/prTime';
import { GithubAvatar } from './GithubAvatar';
import { PrBody } from './PrBody';

// A GitHub inline review comment rendered at the line it was left on. Unlike
// the timeline card there is no hunk preview and no location chip — the
// surrounding diff is the context.
export function PrInlineComment({ comment }: { comment: PrComment }) {
  // The parser is the multi-pass bot-markup normalizer; memoize on the body
  // string so poll ticks and composer keystrokes don't re-parse it.
  const blocks = useMemo(() => prCommentBlocks(comment.body), [comment.body]);
  const time = prRelativeTime(comment.createdAt);
  return (
    <div className="rounded-lg bg-raised py-2 shadow-sm">
      <div className="flex items-center gap-2 px-3">
        <GithubAvatar login={comment.author} size={16} />
        <span className="min-w-0 flex-1 truncate text-body">
          <span className="font-medium text-primary">{displayLogin(comment.author)}</span>
          {time ? (
            <span title={prAbsoluteTime(comment.createdAt)} className="text-muted">
              {' · '}
              {time === 'now' ? 'now' : `${time} ago`}
            </span>
          ) : null}
        </span>
        {comment.resolved === true ? (
          <Badge title="This thread is resolved on GitHub">
            <Octicon name="check" size={11} />
            Resolved
          </Badge>
        ) : null}
        {comment.url ? (
          <a
            href={comment.url}
            target="_blank"
            rel="noreferrer"
            title="Open on GitHub"
            aria-label="Open comment on GitHub"
            className="flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-primary"
            onClick={(event) => {
              event.preventDefault();
              if (comment.url) void openExternal(comment.url);
            }}
          >
            <Octicon name="link-external" size={12} />
          </a>
        ) : null}
      </div>
      <div className="px-3 pt-1 text-body">
        <PrBody blocks={blocks} />
      </div>
    </div>
  );
}
