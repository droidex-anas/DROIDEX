import { useState } from 'react';

import { Badge } from '../../../components/ui/Badge';
import type { PrComment } from '../../../types/vcs';
import { hunkLineTone, hunkLines } from '../lib/prTimeline';

const REACTION_DETAILS = {
  THUMBS_UP: { emoji: '👍', label: 'thumbs up' },
  THUMBS_DOWN: { emoji: '👎', label: 'thumbs down' },
  LAUGH: { emoji: '😄', label: 'laugh' },
  HOORAY: { emoji: '🎉', label: 'hooray' },
  CONFUSED: { emoji: '😕', label: 'confused' },
  HEART: { emoji: '❤️', label: 'heart' },
  ROCKET: { emoji: '🚀', label: 'rocket' },
  EYES: { emoji: '👀', label: 'eyes' },
} as const;

const HUNK_TONE_STYLE = {
  add: { color: 'var(--diff-add-fg)', background: 'var(--diff-add-bg)' },
  del: { color: 'var(--diff-del-fg)', background: 'var(--diff-del-bg)' },
  meta: { color: 'var(--diff-hunk-fg)', background: 'var(--diff-hunk-bg)' },
  context: undefined,
} as const;

export function ReactionChips({ reactions }: { reactions: PrComment['reactions'] }) {
  if (reactions.length === 0) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {reactions.map((reaction) => {
        const details =
          reaction.content in REACTION_DETAILS
            ? REACTION_DETAILS[reaction.content as keyof typeof REACTION_DETAILS]
            : null;
        if (!details) return null;
        return (
          <Badge key={reaction.content} title={`${String(reaction.count)} ${details.label}`}>
            <span aria-hidden="true">{details.emoji}</span>
            <span className="tabular-nums">{reaction.count}</span>
          </Badge>
        );
      })}
    </div>
  );
}

// The reviewed lines, collapsed to the last few by default. Code is the one
// place in this workspace that stays monospaced.
export function HunkPreview({ diffHunk }: { diffHunk: string }) {
  const [expanded, setExpanded] = useState(false);
  const { lines, truncated } = expanded
    ? { lines: diffHunk.replace(/\n+$/, '').split('\n'), truncated: false }
    : hunkLines(diffHunk);
  return (
    <div className="mt-2 overflow-hidden rounded-md bg-elevated/40">
      {truncated ? (
        <button
          type="button"
          onClick={() => {
            setExpanded(true);
          }}
          className="w-full px-3 py-1 text-left text-caption text-muted transition-colors hover:text-primary"
        >
          Show full hunk
        </button>
      ) : null}
      <div className="overflow-x-auto py-1">
        {/* Sized to the widest line so row tones cover the whole scroll range. */}
        <div className="review-diff-content">
          {lines.map((line, index) => {
            const tone = hunkLineTone(line);
            return (
              <div
                key={`${String(index)}-${line}`}
                style={HUNK_TONE_STYLE[tone]}
                className="px-3 font-mono text-code whitespace-pre text-secondary"
              >
                {line || ' '}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
