import { AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';

import { useRelativeTimeNow } from '../../features/projects/useRelativeTimeNow';
import { useProviderUsage } from '../../features/usage/useProviderUsage';
import type { ProviderKind, UsageLimit } from '../../types/bridge';
import { UsageLimitTab } from './UsageLimitTab';
import { UsagePanel } from './UsagePanel';

// The usage tab above the composer, one at a time: /usage while it is open,
// then the limit the chat is held on.
export function UsageTabs({
  provider,
  panelOpen,
  onClosePanel,
  chat,
  onSwitchModel,
}: {
  provider: ProviderKind;
  panelOpen: boolean;
  onClosePanel: () => void;
  // The top-level chat in the composer, and the limit it is held on.
  chat: { usageLimit: UsageLimit | undefined } | undefined;
  onSwitchModel: () => void;
}) {
  const usage = useProviderUsage(provider, panelOpen ? 'panel' : null);
  const now = useRelativeTimeNow();

  let tab: ReactNode = null;
  if (panelOpen)
    tab = (
      <UsagePanel
        key="usage-panel"
        provider={provider}
        usage={usage}
        now={now}
        onClose={onClosePanel}
      />
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

  // One tab leaves before the next rises, so two never stack for a frame.
  return (
    <AnimatePresence initial={false} mode="wait">
      {tab}
    </AnimatePresence>
  );
}
