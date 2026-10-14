import { useRef } from 'react';
import type { IconComponent } from '@droidex/icons';
import { Check, CircleUser, Copy, Download, ExternalLink, GitPullRequest } from '@droidex/icons';

import type { GithubAvailability } from '../../types/vcs';
import type { GithubSetupAction } from '../../hooks/useGithubSetup';
import { useGithubAuthCodeCopy } from '../../hooks/useGithubAuthCodeCopy';
import { Button } from '../ui/Button';
import { Popover } from '../ui/Popover';

export interface GithubSetupCardProps {
  availability: GithubAvailability | null;
  action: GithubSetupAction;
  error: string | null;
  manualGuideOpened: boolean;
  authCode: string | null;
  isAuthPopoverOpen: boolean;
  onPrimaryAction: () => void;
  onShowAuthPrompt: () => void;
  onCloseAuthPrompt: () => void;
  onCancelAuthentication: () => void;
}

interface SetupContent {
  title: string;
  description: string;
  label: string;
  icon: 'download' | 'external' | 'signin' | 'busy';
}

function setupContent(
  availability: GithubAvailability,
  action: GithubSetupAction,
  manualGuideOpened: boolean,
  authCode: string | null,
): SetupContent {
  if (action === 'installing') {
    return {
      title: 'GitHub CLI required',
      description: 'Install GitHub CLI to load pull requests, checks, and comments.',
      label: 'Installing…',
      icon: 'busy',
    };
  }
  if (action === 'authenticating') {
    if (authCode) {
      return {
        title: 'Connect GitHub',
        description: 'GitHub is waiting for the one-time code shown here.',
        label: 'Show sign-in code',
        icon: 'signin',
      };
    }
    return {
      title: 'Connect GitHub',
      description: 'Sign in through GitHub CLI to load pull requests, checks, and comments.',
      label: 'Waiting for GitHub…',
      icon: 'busy',
    };
  }
  if (availability.installed) {
    return {
      title: 'Connect GitHub',
      description: 'Sign in through GitHub CLI to load pull requests, checks, and comments.',
      label: 'Sign in to GitHub',
      icon: 'signin',
    };
  }
  if (availability.installMethod === 'manual') {
    return {
      title: 'GitHub CLI required',
      description: 'Use the official installation page, then return here to check GitHub CLI.',
      label: manualGuideOpened ? 'Check installation' : 'Install GitHub CLI',
      icon: 'external',
    };
  }
  return {
    title: 'GitHub CLI required',
    description: 'Install GitHub CLI to load pull requests, checks, and comments.',
    label: 'Install GitHub CLI',
    icon: 'download',
  };
}

// The busy states show the button's own loading spinner instead of an icon.
const ACTION_ICON: Record<SetupContent['icon'], IconComponent | undefined> = {
  download: Download,
  external: ExternalLink,
  signin: CircleUser,
  busy: undefined,
};

export function GithubAuthPromptContent({
  code,
  copied = false,
  copyFailed = false,
  onCopy,
  onCancel,
}: {
  code: string;
  copied?: boolean;
  copyFailed?: boolean;
  onCopy: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="p-3.5">
      <div className="text-body-strong text-primary">Enter this code on GitHub</div>
      <p className="mt-1 text-caption text-muted">
        Paste this code into GitHub’s device activation page. The browser is already open.
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-md bg-elevated p-2">
        <code className="min-w-0 flex-1 select-all text-center font-mono text-subheading tracking-wider text-primary">
          {code}
        </code>
        <Button
          variant="secondary"
          size="sm"
          icon={copied ? Check : Copy}
          onClick={onCopy}
          className="shrink-0"
        >
          {copied ? 'Copied' : 'Copy code'}
        </Button>
      </div>
      {copyFailed && (
        <p aria-live="polite" className="mt-2 text-caption text-danger">
          Could not copy the code. Select it and copy it manually.
        </p>
      )}
      <div className="mt-3 flex justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel sign-in
        </Button>
      </div>
    </div>
  );
}

export function GithubSetupCard({
  availability,
  action,
  error,
  manualGuideOpened,
  authCode,
  isAuthPopoverOpen,
  onPrimaryAction,
  onShowAuthPrompt,
  onCloseAuthPrompt,
  onCancelAuthentication,
}: GithubSetupCardProps) {
  const actionRef = useRef<HTMLButtonElement>(null);
  const authCodeCopy = useGithubAuthCodeCopy(authCode);
  if (!availability || (availability.installed && availability.authenticated)) return null;

  const isBusy = action !== 'idle' && !authCode;
  const content = setupContent(availability, action, manualGuideOpened, authCode);

  return (
    <div className="mx-1.5 mt-1.5 rounded-lg bg-elevated px-3 py-2.5">
      <div className="flex items-start gap-2">
        <GitPullRequest className="mt-0.5 size-icon-md shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-body-strong text-primary">{content.title}</div>
          <p className="mt-0.5 text-caption text-muted">{content.description}</p>
          <div aria-live="polite">
            {error && <p className="mt-1.5 text-caption text-danger">{error}</p>}
          </div>
          <Button
            ref={actionRef}
            variant="secondary"
            size="sm"
            icon={ACTION_ICON[content.icon]}
            loading={isBusy}
            disabled={isBusy}
            onClick={authCode ? onShowAuthPrompt : onPrimaryAction}
            aria-haspopup={authCode ? 'dialog' : undefined}
            aria-expanded={authCode ? isAuthPopoverOpen : undefined}
            className="mt-2"
          >
            {content.label}
          </Button>
          {isBusy && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancelAuthentication}
              className="ml-2 mt-2"
            >
              {action === 'installing' ? 'Cancel installation' : 'Cancel sign-in'}
            </Button>
          )}
          {authCode && (
            <Popover
              open={isAuthPopoverOpen}
              onClose={onCloseAuthPrompt}
              anchorRef={actionRef}
              label="GitHub sign-in code"
              placement="bottom-start"
              width={320}
            >
              <GithubAuthPromptContent
                code={authCode}
                copied={authCodeCopy.copied}
                copyFailed={authCodeCopy.copyFailed}
                onCopy={() => void authCodeCopy.copyCode()}
                onCancel={() => {
                  onCloseAuthPrompt();
                  onCancelAuthentication();
                }}
              />
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
}
