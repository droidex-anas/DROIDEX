import { useCallback, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { Octicon } from '../../../components/environment/GithubIcons';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Menu } from '../../../components/ui/Menu';
import { prKind } from '../../../lib/github';
import { openExternal } from '../../../lib/onboarding';
import type { PullRequest } from '../../../types/vcs';
import { CUBIC_INVITE_URL, prReviewOptions, type PrReviewAction } from '../lib/prReview';

// Review is the DROIDEX concept; Cubic and the local Droid agent are providers
// under it. Cubic cannot be installed from here, so a repository it has never
// reviewed gets an invitation instead of a trigger.
export function PrReviewButton({
  pr,
  cubicInstalled,
  requesting,
  onRunCubicReview,
  onReviewWithDroid,
}: {
  pr: PullRequest | null;
  cubicInstalled: boolean;
  requesting: boolean;
  onRunCubicReview: () => void;
  onReviewWithDroid: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);

  if (!pr) return null;
  const options = prReviewOptions({ cubicInstalled, kind: prKind(pr) });
  const run = (action: PrReviewAction) => {
    if (action === 'enable-cubic') void openExternal(CUBIC_INVITE_URL);
    if (action === 'run-cubic') onRunCubicReview();
    if (action === 'droid') onReviewWithDroid();
  };

  return (
    <>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Review this pull request"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          <Octicon name="check" size={13} />
          {requesting ? 'Requesting…' : 'Review'}
          <ChevronDown className="size-icon-sm text-muted" />
        </span>
      </Button>
      <Menu
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        placement="bottom-end"
        label="Review pull request"
        width={288}
      >
        <div className="flex items-center gap-2 px-3 pb-1 pt-1.5">
          <span className="text-label text-muted">Review pull request</span>
          {cubicInstalled ? <Badge>Cubic connected</Badge> : null}
        </div>
        {options.map((option) => (
          <Menu.Item
            key={option.action}
            disabled={requesting && option.action === 'run-cubic'}
            onSelect={() => {
              run(option.action);
            }}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                {option.title}
                {option.action === 'enable-cubic' ? (
                  <Octicon name="link-external" size={11} className="text-muted" />
                ) : null}
              </span>
              <span className="block text-caption text-muted">{option.hint}</span>
            </span>
          </Menu.Item>
        ))}
        {options.some((option) => option.action === 'enable-cubic') ? (
          <p
            title="DROIDEX may receive a reward if you upgrade."
            className="px-3 pb-1 pt-0.5 text-caption text-muted"
          >
            Referral link
          </p>
        ) : null}
      </Menu>
    </>
  );
}
