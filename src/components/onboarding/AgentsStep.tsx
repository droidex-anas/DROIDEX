import { useEffect, useState } from 'react';
import { Check, RefreshCw } from '@droidex/icons';
import { PROVIDER_LABELS } from '../../features/providers/providerIdentity';
import type { ProviderKind } from '../../types/bridge';
import { ActivityStatusGlyph } from '../ActivityStatusGlyph';
import { Button } from '../ui/Button';
import { AgentTile } from './AgentTile';
import {
  AGENT_MAKERS,
  AGENTS,
  canStartChats,
  joinNames,
  type AgentStatus,
  type AgentStatuses,
} from './agents';
import { StepHeader } from './StepHeader';

// The scan reveals one agent at a time, so finding them reads as a check
// rather than a flash.
const FIRST_LOOK_MS = 560;
const NEXT_LOOK_MS = 420;

type Glyph = 'ready' | 'approval' | 'settled' | 'interrupted';

function foundLine(status: AgentStatus): { glyph: Glyph; text: string } {
  switch (status.state) {
    case 'checking':
    case 'missing':
      return { glyph: 'ready', text: 'Not installed · DROIDEX can install it' };
    case 'unavailable':
      return { glyph: 'interrupted', text: status.reason };
    case 'signin': {
      const installed = status.install.version
        ? `Installed ${status.install.version}`
        : 'Installed';
      return { glyph: 'approval', text: `${installed} · needs sign-in` };
    }
    case 'ready': {
      const parts = ['Ready', status.install.version, status.account].filter(Boolean);
      return { glyph: 'settled', text: parts.join(' · ') };
    }
  }
}

function nextUp(chosen: readonly ProviderKind[], statuses: AgentStatuses): string {
  if (chosen.length === 0) return 'Pick at least one agent to continue.';
  const install = chosen.filter((agent) => statuses[agent].state === 'missing');
  const signIn = chosen.filter((agent) => statuses[agent].state === 'signin');
  const parts: string[] = [];
  if (install.length > 0) parts.push(`install ${joinNames(install)}`);
  if (signIn.length > 0) parts.push(`sign in to ${joinNames(signIn)}`);
  if (parts.length > 0) return `Next, DROIDEX helps you ${parts.join(' and ')}.`;
  if (chosen.every((agent) => canStartChats(statuses[agent]))) {
    return 'Everything you picked is ready to use.';
  }
  return 'Continue to see what the rest need.';
}

export function AgentsStep({
  chosen,
  statuses,
  scanned,
  onToggle,
  onSpotlight,
  onScanned,
  onRescan,
}: {
  chosen: readonly ProviderKind[];
  statuses: AgentStatuses;
  /** The scan has already played; returning to the step shows its result at once. */
  scanned: boolean;
  onToggle: (agent: ProviderKind) => void;
  onSpotlight: (agent: ProviderKind) => void;
  onScanned: () => void;
  onRescan: () => void;
}) {
  const [looked, setLooked] = useState(scanned ? AGENTS.length : 0);
  const revealing = looked < AGENTS.length;
  const scanning = revealing || AGENTS.some((agent) => statuses[agent].state === 'checking');

  useEffect(() => {
    if (!revealing) return;
    const timer = window.setTimeout(
      () => {
        setLooked((count) => count + 1);
      },
      looked === 0 ? FIRST_LOOK_MS : NEXT_LOOK_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [revealing, looked]);

  useEffect(() => {
    if (!scanning && !scanned) onScanned();
  }, [scanning, scanned, onScanned]);

  const note = scanning ? 'Checking this Mac for agent CLIs' : nextUp(chosen, statuses);

  return (
    <div className="flex flex-col">
      <StepHeader
        title="Choose your agents"
        sub="DROIDEX runs each agent on its own CLI and keeps their chats side by side. Pick the ones you want to work with."
      />
      <div
        role="group"
        aria-label="Agents"
        className="droid-rise mt-7 flex flex-col gap-1.5"
        style={{ animationDelay: '100ms' }}
      >
        {AGENTS.map((agent, index) => {
          const status = statuses[agent];
          const found = index < looked && status.state !== 'checking';
          const line = foundLine(status);
          return (
            <button
              key={agent}
              type="button"
              role="checkbox"
              aria-checked={chosen.includes(agent)}
              className="ob-option"
              onClick={() => {
                onToggle(agent);
              }}
              onPointerEnter={() => {
                onSpotlight(agent);
              }}
              onFocus={() => {
                onSpotlight(agent);
              }}
            >
              <AgentTile agent={agent} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline gap-1.5">
                  <span className="text-body-strong text-primary">{PROVIDER_LABELS[agent]}</span>
                  <span className="text-caption text-muted">{AGENT_MAKERS[agent]}</span>
                </span>
                <span className="flex h-4 min-w-0 items-center text-caption">
                  {found ? (
                    <span
                      key="found"
                      className="droid-rise flex min-w-0 items-center gap-1.5 text-secondary"
                    >
                      <ActivityStatusGlyph status={line.glyph} decorative />
                      <span className="truncate">{line.text}</span>
                    </span>
                  ) : (
                    <span className={index <= looked ? 'shimmer-text' : 'text-quiet'}>
                      Looking for {agent}
                    </span>
                  )}
                </span>
              </span>
              <span className="ob-check" aria-hidden="true">
                <Check size={14} strokeWidth={2.75} className="ob-tick" />
              </span>
            </button>
          );
        })}
      </div>
      <div
        className="droid-rise mt-3 flex h-7 items-center gap-3 pl-1.5"
        style={{ animationDelay: '160ms' }}
      >
        <span
          key={note}
          className={`droid-rise min-w-0 flex-1 text-caption ${scanning ? 'shimmer-text' : 'text-muted'}`}
        >
          {note}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={RefreshCw}
          disabled={scanning}
          onClick={() => {
            setLooked(0);
            onRescan();
          }}
        >
          Check again
        </Button>
      </div>
    </div>
  );
}
