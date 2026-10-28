import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Settings } from '@droidex/icons';
import { useStoreDispatch } from '../hooks/useStore';
import { bindLazySurfaceIntent } from '../lib/chunkPreloader';
import { Row } from './ui/Row';
import { SidebarAppUpdateButton } from './SidebarAppUpdateButton';
import { SidebarWelcomeCard } from './SidebarWelcomeCard';

// The footer floats over the bottom of the session list so rows can pass
// underneath it. It publishes its height to the list as
// `--sidebar-footer-height` (the list reserves that much at its end), and marks
// itself `data-content-under` while rows sit behind it, which fades in the
// blur layer (index.css, `.sidebar-footer`). Both are written straight to the
// elements, so scrolling never re-renders the sidebar.
function useFloatOver(
  footerRef: RefObject<HTMLElement | null>,
  scrollRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const footer = footerRef.current;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!footer || !scroller || !content) return;
    // The list's end padding equals the footer, so any distance still left
    // to scroll is content sitting under the footer.
    const markContentUnder = () => {
      const remaining = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      footer.toggleAttribute('data-content-under', remaining > 1);
    };
    const reserveFooter = () => {
      scroller.style.setProperty('--sidebar-footer-height', `${String(footer.offsetHeight)}px`);
      markContentUnder();
    };
    reserveFooter();
    const footerObserver = new ResizeObserver(reserveFooter);
    footerObserver.observe(footer);
    const listObserver = new ResizeObserver(markContentUnder);
    listObserver.observe(scroller);
    listObserver.observe(content);
    scroller.addEventListener('scroll', markContentUnder, { passive: true });
    return () => {
      footerObserver.disconnect();
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
}: {
  scrollRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  welcomeVisible: boolean;
  onStartChat: () => void;
  onDismissWelcome: () => void;
}) {
  const dispatch = useStoreDispatch();
  const footerRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  useFloatOver(footerRef, scrollRef, contentRef);
  useEffect(() => bindLazySurfaceIntent('settings', settingsButtonRef.current), []);

  return (
    <div ref={footerRef} className="sidebar-footer absolute inset-x-0 bottom-0 z-10 px-2 pb-2 pt-4">
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
