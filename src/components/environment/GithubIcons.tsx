import { useId, type ReactNode } from 'react';
import {
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  GitPullRequestMerged,
  type IconComponent,
} from '@droidex/icons';

import type { PrChecksRollup } from '../../types/vcs';
import type { CheckStatus, PrKind } from '../../lib/github';
import { cn } from '../ui/cn';

// Icon geometry copied from @primer/octicons 19.15.5 (MIT), 16px variants.
// Only the glyphs that still have no DROIDEX counterpart live here: GitHub's
// own mark is a brand, and the git-graph glyphs still serve the branch menus.
const OCTICON_PATHS = {
  'git-commit':
    'M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z',
  'git-branch':
    'M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
  'git-pull-request':
    'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
  'mark-github':
    'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z',
} as const;

type OcticonName = keyof typeof OCTICON_PATHS;

function Octicon({
  name,
  size,
  className,
}: {
  name: OcticonName;
  size: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d={OCTICON_PATHS[name]} />
    </svg>
  );
}

interface IconProps {
  size?: number;
  className?: string;
}

export const GitCommitIcon = ({ size = 16, className }: IconProps) => (
  <Octicon name="git-commit" size={size} className={className} />
);

export const GitBranchIcon = ({ size = 16, className }: IconProps) => (
  <Octicon name="git-branch" size={size} className={className} />
);

export const GitHubMarkIcon = ({ size = 16, className }: IconProps) => (
  <Octicon name="mark-github" size={size} className={className} />
);

export const GitPullRequestIcon = ({ size = 16, className }: IconProps) => (
  <Octicon name="git-pull-request" size={size} className={className} />
);

// The pull request state in the DROIDEX git family, coloured by status: open
// and closed share the success/danger signal, merged keeps GitHub's violet.
const PR_STATES: Record<PrKind, { icon: IconComponent; label: string; tone: string }> = {
  open: { icon: GitPullRequest, label: 'Open', tone: 'text-success' },
  draft: { icon: GitPullRequestDraft, label: 'Draft', tone: 'text-muted' },
  merged: { icon: GitPullRequestMerged, label: 'Merged', tone: 'text-presence-violet' },
  closed: { icon: GitPullRequestClosed, label: 'Closed', tone: 'text-danger' },
};

// The check rollup as a dot on the icon's corner, so a list of PRs scans by
// colour first: red needs attention, amber is still running, green is clear.
// A ring in the canvas colour keeps the dot separate from the glyph.
const CHECK_DOTS: Record<PrChecksRollup, { fill: string; label: string }> = {
  fail: { fill: 'bg-danger', label: 'checks failing' },
  pending: { fill: 'bg-warning', label: 'checks running' },
  pass: { fill: 'bg-success', label: 'checks passing' },
};

export function PrStateIcon({
  kind,
  size = 16,
  checks,
}: {
  kind: PrKind;
  size?: number;
  checks?: PrChecksRollup | null;
}) {
  const { icon: Icon, label, tone } = PR_STATES[kind];
  // A merged or closed PR's checks no longer matter; only a live one wears
  // the dot.
  const live = kind === 'open' || kind === 'draft';
  const dot = live && checks ? CHECK_DOTS[checks] : null;
  const name = dot ? `${label}, ${dot.label}` : label;
  return (
    <span
      title={dot ? `${label} · ${dot.label}` : label}
      className={cn('relative inline-flex', tone)}
    >
      <Icon size={size} aria-label={name} />
      {dot && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -right-px -bottom-px size-1.5 rounded-full ring-1.5 ring-bg',
            dot.fill,
          )}
        />
      )}
    </span>
  );
}

// A status disc with its mark knocked out, so the mark shows whatever surface
// the row sits on. Marks are centred on the 24px grid at the set's 2px weight.
const CHECK_STATES: Record<CheckStatus, { label: string; tone: string; mark: ReactNode }> = {
  success: {
    label: 'Passed',
    tone: 'text-success',
    mark: <path d="M8.5 12.25 10.75 14.5 15.5 9.5" />,
  },
  failure: { label: 'Failed', tone: 'text-danger', mark: <path d="m9.5 9.5 5 5m0-5-5 5" /> },
  // Skipped, cancelled, stale, and action-required runs all land here, so the
  // label states the bucket rather than one of its members.
  neutral: { label: 'Neutral', tone: 'text-muted', mark: <path d="M8.75 12h6.5" /> },
  pending: { label: 'Pending', tone: 'text-warning', mark: null },
};

export function CheckStatusIcon({ status, size = 16 }: { status: CheckStatus; size?: number }) {
  const maskId = useId();
  const { label, tone, mark } = CHECK_STATES[status];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className={cn('shrink-0', tone)}
    >
      <title>{label}</title>
      {mark ? (
        <>
          {/* Mask luminance: the white field keeps the disc, the black mark cuts it. */}
          <mask id={maskId}>
            <rect width="24" height="24" fill="white" />
            <g
              fill="none"
              stroke="black"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {mark}
            </g>
          </mask>
          <circle cx="12" cy="12" r="9.25" fill="currentColor" mask={`url(#${maskId})`} />
        </>
      ) : (
        <>
          <circle cx="12" cy="12" r="8.4" fill="none" stroke="currentColor" strokeWidth="1.75" />
          <circle
            cx="12"
            cy="12"
            r="3"
            fill="currentColor"
            className="animate-breathe motion-reduce:animate-none"
          />
        </>
      )}
    </svg>
  );
}
