import { Suspense, lazy, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
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

// The footer sits below the session list and overlaps its last 16px (the
// footer's top padding), where rows dissolve into it. It marks itself
// `data-content-under` while rows sit behind that edge, which fades in the
// blur layer (index.css, `.sidebar-footer`). The attribute is written straight
// to the element, so scrolling never re-renders the sidebar.
function useContentUnderMark(
  footerRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const footer = footerRef.current;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!footer || !scroller || !content) return;
    // The list's end padding equals the overlap, so any distance still left
    // to scroll is content sitting under the footer's edge.
    const markContentUnder = () => {
      const remaining = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      footer.toggleAttribute('data-content-under', remaining > 1);
    };
    markContentUnder();
    const listObserver = new ResizeObserver(markContentUnder);
    listObserver.observe(scroller);
    listObserver.observe(content);
    scroller.addEventListener('scroll', markContentUnder, { passive: true });
    return () => {
      listObserver.disconnect();
      scroller.removeEventListener('scroll', markContentUnder);
    };
  }, [footerRef, scrollRef, contentRef]);
}

export function SidebarFooter({
  scrollRef,
  contentRef,
  welcomeVisible,
  onStartChat,
  onDismissWelcome,
  remoteLaunchVisible,
  onRetireRemoteLaunch,
}: {
  scrollRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  welcomeVisible: boolean;
  onStartChat: () => void;
  onDismissWelcome: () => void;
  remoteLaunchVisible: boolean;
  onRetireRemoteLaunch: () => void;
}) {
  const dispatch = useStoreDispatch();
  const footerRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  useContentUnderMark(footerRef, scrollRef, contentRef);
  useEffect(() => bindLazySurfaceIntent('settings', settingsButtonRef.current), []);

  return (
    <div ref={footerRef} className="sidebar-footer relative z-10 -mt-4 shrink-0 px-2 pb-2 pt-4">
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
