import { useMemo } from 'react';
import { Check, ExternalLink } from '@droidex/icons';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
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
    <div className="group rounded-lg bg-raised px-3 pt-1.5 pb-2.5 shadow-sm">
      <div className="flex h-control-sm items-center gap-2">
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
          <Badge title="This thread is resolved on GitHub" icon={Check}>
            Resolved
          </Badge>
        ) : null}
        {comment.url ? (
          <Tooltip label="Open on GitHub">
            <Button
              variant="ghost"
              size="sm"
              icon={ExternalLink}
              aria-label="Open comment on GitHub"
              className="-mr-1.5 opacity-0 transition-opacity duration-quick group-hover:opacity-100 group-focus-within:opacity-100"
              onClick={() => {
                if (comment.url) void openExternal(comment.url);
              }}
            />
          </Tooltip>
        ) : null}
      </div>
      {/* The body starts under the name, past the 16px avatar and its gap. */}
      <div className="pl-6 text-body">
        <PrBody blocks={blocks} />
      </div>
    </div>
  );
}
