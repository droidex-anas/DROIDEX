import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { Octicon } from '../../../components/environment/GithubIcons';
import { Button } from '../../../components/ui/Button';
import { Menu } from '../../../components/ui/Menu';
import { prKind } from '../../../lib/github';
import type { PrMergeMethod, PullRequest } from '../../../types/vcs';
import { mergeBlockReason } from '../lib/prMeta';

const METHODS: { id: PrMergeMethod; label: string; hint: string }[] = [
  { id: 'merge', label: 'Create a merge commit', hint: 'Keeps every commit and adds a merge' },
  { id: 'squash', label: 'Squash and merge', hint: 'Combines the commits into one' },
  { id: 'rebase', label: 'Rebase and merge', hint: 'Replays the commits onto the base' },
];

function mergeLabel(merging: boolean, merged: boolean): string {
  if (merged) return 'Merged';
  return merging ? 'Merging…' : 'Merge';
}

function mergeButtonTitle(blocked: string | null, merging: boolean, merged: boolean): string {
  if (merged) return 'Pull request merged';
  if (merging) return 'Merging pull request';
  return blocked ?? 'Merge this pull request';
}

// eslint-disable-next-line react-refresh/only-export-components
export function mergePullRequestKey(pr: PullRequest, repositoryKey: string): string {
  return pr.url || `${repositoryKey}#${String(pr.number)}`;
}

// Merging happens through `gh pr merge`, so the strategy is picked explicitly:
// the button opens the list and the chosen entry performs the merge. There is no
// separate confirmation because choosing a strategy already states the intent.
export function PrMergeButton({
  pr,
  repositoryKey,
  merging,
  onMerge,
}: {
  pr: PullRequest | null;
  repositoryKey: string;
  merging: boolean;
  onMerge: (method: PrMergeMethod) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  // A merge lands before the refreshed pull request does, so the button stays
  // disabled on the merged pull request instead of offering a second merge
  // while the still-open data is on screen. Keyed by URL because a number
  // repeats across repositories.
  const [mergedKey, setMergedKey] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const kind = pr ? prKind(pr) : null;
  // A merged or closed pull request has nothing left to merge.
  const blocked = pr ? mergeBlockReason(pr) : null;
  const prKey = pr ? mergePullRequestKey(pr, repositoryKey) : null;
  const merged = prKey !== null && mergedKey === prKey;
  const disabled = merging || merged || blocked !== null;
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  if (!pr || kind === 'merged' || kind === 'closed' || prKey === null) return null;

  return (
    <>
      <Button
        ref={triggerRef}
        variant="success"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open && !disabled}
        disabled={disabled}
        title={mergeButtonTitle(blocked, merging, merged)}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          <Octicon name="git-merge" size={13} />
          {mergeLabel(merging, merged)}
          <ChevronDown className="size-icon-sm" />
        </span>
      </Button>
      <Menu
        open={open && !disabled}
        onClose={close}
        anchorRef={triggerRef}
        placement="bottom-end"
        label="Merge pull request"
        width={256}
      >
        {METHODS.map((method) => (
          <Menu.Item
            key={method.id}
            onSelect={() => {
              void onMerge(method.id).then((ok) => {
                if (ok) setMergedKey(prKey);
              });
            }}
          >
            <span className="min-w-0">
              <span className="block">{method.label}</span>
              <span className="block text-caption text-muted">{method.hint}</span>
            </span>
          </Menu.Item>
        ))}
      </Menu>
    </>
  );
}
