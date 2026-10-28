import { AnimatePresence } from 'framer-motion';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';

import { PROVIDER_LABELS } from '../../features/providers/providerIdentity';
import { paceWarning } from '../../features/usage/usagePace';
import { useProviderUsage, type UsageWatch } from '../../features/usage/useProviderUsage';
import { useRuntimeHealth } from '../../hooks/useRuntimeHealth';
import type { ProviderKind, ProviderUsage, UsageLimit } from '../../types/bridge';
import { UsageLimitTab, UsageWarningTab } from './UsageLimitTab';

// /usage opens on demand, so its panel loads with the first open.
const UsagePanel = lazy(() => import('./UsagePanel').then((m) => ({ default: m.UsagePanel })));

const TICK_MS = 30_000;

// The usage tab above the composer, one at a time: /usage while it is open,
// then the limit the chat is held on, then a warning that the current pace
// runs a Claude Code or Codex limit out before it resets.
export function UsageTabs({
  provider,
  connected,
  panelOpen,
  onClosePanel,
  chat,
  onSwitchModel,
}: {
  provider: ProviderKind;
  connected: boolean;
  panelOpen: boolean;
  onClosePanel: () => void;
  // The top-level chat in the composer, and the limit it is held on.
  chat: { usageLimit: UsageLimit | undefined } | undefined;
  onSwitchModel: () => void;
}) {
  const warns = chat !== undefined && provider !== 'droid';
  let watch: UsageWatch | null = null;
  if (panelOpen) watch = 'panel';
  else if (warns) watch = 'chat';
  // The socket's own state too: a reconnect must refresh even where the
  // runtime never reported itself down.
  const socketUp = useRuntimeHealth().transport === 'connected';
  const reachable = connected && socketUp;
  const usage = useProviderUsage(provider, watch, reachable);
  const now = Date.now();
  const warning = warns && usage ? paceWarning(usage.meters, now) : undefined;
  useTicking(panelOpen || warning !== undefined);

  let tab: ReactNode = null;
  if (panelOpen)
    tab = (
      <Suspense key="usage-panel" fallback={null}>
        <UsagePanel
          provider={provider}
          usage={usage}
          reachable={reachable}
          now={now}
          onClose={onClosePanel}
        />
      </Suspense>
    );
  else if (chat?.usageLimit)
    tab = (
      <UsageLimitTab
        key="usage-limit"
        limit={chat.usageLimit}
        provider={provider}
        onSwitchModel={onSwitchModel}
      />
    );
  else if (warning)
    tab = <UsageWarningTab key="usage-warning" warning={warning} provider={provider} now={now} />;

  // One tab leaves before the next rises, so two never stack for a frame.
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {panelOpen && panelAnnouncement(provider, usage, reachable)}
      </span>
      <AnimatePresence initial={false} mode="wait">
        {tab}
      </AnimatePresence>
    </>
  );
}

// Tells a screen reader, whose focus stays in the composer, that /usage
// opened and when its answer is in.
function panelAnnouncement(
  provider: ProviderKind,
  usage: ProviderUsage | undefined,
  reachable: boolean,
): string {
  const name = PROVIDER_LABELS[provider];
  if (!usage && reachable) return `Checking ${name} usage…`;
  return `${name} usage is open above the composer.`;
}

// Renders again every half minute while a tab shows countdowns and a pace.
function useTicking(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setTick((tick) => tick + 1);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
}
