import { useMemo, useState } from 'react';
import { Check, Clock, ExternalLink, FileDiff, X, type IconComponent } from '@droidex/icons';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { openExternal } from '../../../lib/onboarding';
import type { PrTone } from '../../../lib/github';
import type { PrComment } from '../../../types/vcs';
import { prCommentBlocks, prCommentProse } from '../lib/prCommentBody';
import {
  commentPreview,
  commentStartsFolded,
  threadStatus,
  type PrThreadStatus,
} from '../lib/prCommentFold';
import { displayLogin } from '../lib/prIdentity';
import { prAbsoluteTime, prRelativeTime } from '../lib/prTime';
import { commentActionLabel, inlineLocation, reviewBadge } from '../lib/prTimeline';
import { PrBody } from './PrBody';
import { FoldChevron, PrCollapse } from './PrCollapse';
import { HunkPreview, ReactionChips } from './PrCommentContent';

const THREAD_STATUS_ICON: Record<PrThreadStatus['icon'], IconComponent> = {
  check: Check,
  clock: Clock,
};

const REVIEW_BADGE_ICON: Partial<Record<PrTone, IconComponent>> = {
  success: Check,
  danger: X,
};

// `threadStatus` reports one settled state and prefers "Resolved", but a thread
// can be resolved on lines that have since changed, and both facts matter. The
// second lookup asks the same owner for the outdated state instead of restating
// its label here.
function threadStatuses(comment: PrComment): PrThreadStatus[] {
  const resolved = comment.resolved === true ? threadStatus(comment) : null;
  const outdated = threadStatus({ ...comment, resolved: false });
  return [resolved, outdated].filter((status): status is PrThreadStatus => status !== null);
}

function CommentByline({ comment }: { comment: PrComment }) {
  const time = prRelativeTime(comment.createdAt);
  return (
    <span className="min-w-0 truncate text-body">
      <span className="font-medium text-primary">{displayLogin(comment.author)}</span>
      <span className="text-muted"> {commentActionLabel(comment)}</span>
      {time ? (
        <span title={prAbsoluteTime(comment.createdAt)} className="text-muted">
          {' · '}
          {/* `prRelativeTime` returns either "now" or an age like "3d", and
              only an age reads as "ago". */}
          {time === 'now' ? 'now' : `${time} ago`}
        </span>
      ) : null}
    </span>
  );
}

function CommentMeta({ comment }: { comment: PrComment }) {
  const badge = reviewBadge(comment);
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {threadStatuses(comment).map((status) => (
        <Badge key={status.label} title={status.title} icon={THREAD_STATUS_ICON[status.icon]}>
          {status.label}
        </Badge>
      ))}
      {badge ? (
        <Badge tone={badge.tone} icon={REVIEW_BADGE_ICON[badge.tone]}>
          {badge.label}
        </Badge>
      ) : null}
      {comment.url ? (
        <Tooltip label="Open on GitHub">
          <Button
            variant="ghost"
            size="sm"
            icon={ExternalLink}
            aria-label="Open comment on GitHub"
            onClick={() => {
              if (comment.url) void openExternal(comment.url);
            }}
          />
        </Tooltip>
      ) : null}
    </span>
  );
}

// Resolved threads and long comments arrive folded: the card shows who said
// what, where, and the first line, then opens on click. A short open comment
// has nothing worth folding, so it keeps a plain header with no chevron.
export function PrCommentCard({ comment }: { comment: PrComment }) {
  // The bot-markup parser is several regex passes over the body; key it on
  // the string so keystrokes in the composer and unchanged polls cost nothing.
  const blocks = useMemo(() => prCommentBlocks(comment.body), [comment.body]);
  const prose = useMemo(() => prCommentProse(blocks), [blocks]);
  const foldable = commentStartsFolded(comment, prose);
  const [open, setOpen] = useState(!foldable);
  // Polling can edit or resolve a comment under the same id: a card that stops
  // being foldable must not stay collapsed with no way to expand it.
  const [appliedFoldable, setAppliedFoldable] = useState(foldable);
  if (foldable !== appliedFoldable) {
    setAppliedFoldable(foldable);
    setOpen(!foldable);
  }
  const location = inlineLocation(comment);
  const preview = commentPreview(prose);
  const previewLine = location && preview ? `${location.label} · ${preview}` : preview;

  return (
    <article className="rounded-xl bg-surface">
      {/* The meta sits beside the toggle, not inside it, so its link stays its
          own control. */}
      <header className="flex min-h-10 items-center gap-2 py-1.5 pr-1.5 pl-1.5">
        {foldable ? (
          <button
            type="button"
            aria-expanded={open}
            title={open ? 'Collapse comment' : 'Expand comment'}
            onClick={() => {
              setOpen((value) => !value);
            }}
            className="group flex min-w-0 flex-1 flex-col justify-center rounded-md px-2.5 py-1 text-left transition-colors duration-quick hover:bg-elevated"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <CommentByline comment={comment} />
              <FoldChevron open={open} />
            </span>
            {!open && previewLine ? (
              <span className="mt-0.5 block truncate text-body text-muted">{previewLine}</span>
            ) : null}
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-center px-2.5">
            <CommentByline comment={comment} />
          </span>
        )}
        <CommentMeta comment={comment} />
      </header>
      <PrCollapse open={open}>
        <div className="px-4 pt-1 pb-4">
          {location ? (
            <p
              title={location.title}
              className="mb-2.5 flex h-6 w-fit max-w-full items-center gap-1.5 rounded-sm bg-elevated px-2 text-label text-secondary"
            >
              <FileDiff className="size-icon-sm shrink-0 text-muted" aria-hidden="true" />
              {/* Open cards have room for the full path: two files with the
                  same basename are otherwise indistinguishable. */}
              <span className="truncate">{location.title}</span>
            </p>
          ) : null}
          {comment.diffHunk ? <HunkPreview diffHunk={comment.diffHunk} /> : null}
          <PrBody blocks={blocks} />
          <ReactionChips reactions={comment.reactions} />
        </div>
      </PrCollapse>
    </article>
  );
}
