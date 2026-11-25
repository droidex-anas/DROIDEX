import { Suspense, lazy, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Settings } from '@droidex/icons';
import { useStoreDispatch } from '../hooks/useStore';
import { bindLazySurfaceIntent } from '../lib/chunkPreloader';
import { Row } from './ui/Row';
import { SidebarAppUpdateButton } from './SidebarAppUpdateButton';
import { SidebarWelcomeCard } from './SidebarWelcomeCard';

// The card's isometric art is sizeable and most launches never show it.
const RemoteLaunchCard = lazy(async () => {
  const module = await import('../features/remote/RemoteLaunchCard');
  return { default: module.RemoteLaunchCard };
});

export function SidebarFooter({
  welcomeVisible,
  onStartChat,
  onDismissWelcome,
  remoteLaunchVisible,
  onRetireRemoteLaunch,
}: {
  welcomeVisible: boolean;
  onStartChat: () => void;
  onDismissWelcome: () => void;
  remoteLaunchVisible: boolean;
  onRetireRemoteLaunch: () => void;
}) {
  const dispatch = useStoreDispatch();
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => bindLazySurfaceIntent('settings', settingsButtonRef.current), []);

  return (
    <div className="shrink-0 px-2 pb-2 pt-4">
      <AnimatePresence>
        {welcomeVisible && (
          <SidebarWelcomeCard
            onStart={() => {
              onDismissWelcome();
              onStartChat();
            }}
            onDismiss={onDismissWelcome}
          />
        )}
        {remoteLaunchVisible && (
          <Suspense key="remote-launch" fallback={null}>
            <RemoteLaunchCard
              onClaim={() => {
                onRetireRemoteLaunch();
                dispatch({
                  type: 'OPEN_SETTINGS',
                  request: { tab: 'Remote', step: 'claim-username' },
                });
              }}
              onDismiss={onRetireRemoteLaunch}
            />
          </Suspense>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-1">
        <Row
          ref={settingsButtonRef}
          icon={<Settings className="size-icon-md" />}
          label="Settings"
          onClick={() => {
            dispatch({ type: 'TOGGLE_SETTINGS' });
          }}
          className="min-w-0 flex-1"
        />
        <SidebarAppUpdateButton />
      </div>
    </div>
  );
}
