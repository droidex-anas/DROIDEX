import { useEffect, useId, useState } from 'react';
import { Check, KeyRound } from '@droidex/icons';
import {
  PROVIDER_LABELS,
  PROVIDER_SIGN_IN_COMMANDS,
} from '../../features/providers/providerIdentity';
import type { ProviderKind } from '../../types/bridge';
import { Expand } from '../transcript/primitives';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import { AGENT_MAKERS, type AgentInstall, type AgentStatus } from './agents';
import { CommandLine } from './CommandLine';
import { recheckAgents } from './useAgentSetup';

// A re-check answers through the bridge; past this, stop showing it as busy.
const CHECK_TIMEOUT_MS = 8000;

type SignInStatus = Extract<AgentStatus, { state: 'signin' }>;
type ReadyStatus = Extract<AgentStatus, { state: 'ready' }>;

function installedPhrase(install: AgentInstall): string {
  let phrase = install.version ? `Installed ${install.version}` : 'Installed';
  if (install.source) phrase += ` with ${install.source}`;
  return phrase;
}

function ApiKeyForm({
  saveApiKey,
  onClose,
}: {
  saveApiKey: (key: string) => Promise<void>;
  onClose: () => void;
}) {
  const noteId = useId();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveApiKey(key);
      setKey('');
      onClose();
    } catch {
      setError("Couldn't save the API key. Check that secure storage is available and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-1.5 pt-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          type="password"
          aria-label="Factory API key"
          aria-describedby={noteId}
          placeholder="Factory API key"
          autoComplete="off"
          spellCheck={false}
          invalid={error !== null}
          value={key}
          className="flex-1"
          onChange={(event) => {
            setKey(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
        />
        <Button
          type="submit"
          variant="secondary"
          size="lg"
          loading={saving}
          disabled={saving || !key.trim()}
        >
          Save key
        </Button>
      </div>
      <p id={noteId} className={`text-caption ${error ? 'text-danger' : 'text-muted'}`}>
        {error ?? 'Saved to secure storage on this Mac.'}
      </p>
    </form>
  );
}

/** An installed agent waiting on a sign-in made in Terminal, which DROIDEX then picks up. */
export function SignIn({
  agent,
  status,
  saveApiKey,
  onSkip,
}: {
  agent: ProviderKind;
  status: SignInStatus;
  saveApiKey: (key: string) => Promise<void>;
  onSkip: () => void;
}) {
  const label = PROVIDER_LABELS[agent];
  const account = `${AGENT_MAKERS[agent]} account`;
  const [showKey, setShowKey] = useState(false);
  // The status the last check started from: a new status object means its
  // answer arrived, so the check is over without a flag to reset.
  const [checkedFrom, setCheckedFrom] = useState<AgentStatus | null>(null);
  const checking = checkedFrom === status;

  useEffect(() => {
    if (!checking) return;
    const timer = window.setTimeout(() => {
      setCheckedFrom(null);
    }, CHECK_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [checking]);

  const intro = status.canRun
    ? `${installedPhrase(status.install)}, but it reports no sign-in. Sign in to your ${account} in Terminal, or skip this if ${label} reaches its models another way.`
    : `${installedPhrase(status.install)}. Sign in to your ${account} in Terminal, then check here.`;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-secondary">{intro}</p>
      <CommandLine command={PROVIDER_SIGN_IN_COMMANDS[agent]} />
      <div className="flex h-8 items-center gap-2">
        <Button
          variant="primary"
          data-primary
          loading={checking}
          disabled={checking}
          onClick={() => {
            setCheckedFrom(status);
            recheckAgents();
          }}
        >
          Check sign-in
        </Button>
        {agent === 'droid' && (
          <Button
            variant="ghost"
            icon={KeyRound}
            aria-expanded={showKey}
            onClick={() => {
              setShowKey((shown) => !shown);
            }}
          >
            Use an API key
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" onClick={onSkip}>
          Skip for now
        </Button>
      </div>
      {agent === 'droid' && (
        <Expand open={showKey}>
          <ApiKeyForm
            saveApiKey={saveApiKey}
            onClose={() => {
              setShowKey(false);
            }}
          />
        </Expand>
      )}
    </div>
  );
}

function ReadyLine({ text, meta }: { text: string; meta?: string | undefined }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Check className="ob-pop size-icon-sm shrink-0 text-success" aria-hidden="true" />
      <span className="shrink-0 text-body text-primary">{text}</span>
      {meta !== undefined && (
        <span className="min-w-0 truncate font-mono text-code-sm text-muted">{meta}</span>
      )}
    </div>
  );
}

export function ReadyBody({ status }: { status: ReadyStatus }) {
  return (
    <div className="flex flex-col gap-2 pb-0.5">
      <ReadyLine text={installedPhrase(status.install)} meta={status.install.path} />
      <ReadyLine text={`Signed in · ${status.account}`} />
    </div>
  );
}
