import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import { useGitEnvironment } from '../hooks/useGitEnvironment';
import { useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { openBrowser } from '../lib/commands';
import { isDesktop } from '../lib/desktop';
import { describeLink } from '../lib/linkPresentation';
import { openExternal } from '../lib/onboarding';
import {
  parsePullRequestLink,
  resolvePullRequestPaneTarget,
} from '../features/pull-requests/lib/prLinkTarget';

// What a link in a chat transcript can do beyond following itself. GitHub
// links open in the in-app browser by default — a pull request belongs next
// to the conversation about it — and right-click always offers both targets.
export interface LinkActions {
  // The default click target: a pull request link opens in the pane when it
  // names the chat's own repository, everything else in the in-app browser.
  openLink: (url: string) => void;
  openInAppBrowser: (url: string) => void;
  openMenu: (position: { x: number; y: number }, url: string) => void;
}

export const LinkActionsContext = createContext<LinkActions | null>(null);

// A link opens in the side-panel browser when it names something the app has
// a real view of: GitHub pull requests, issues, and commits. Everything else
// keeps the system browser.
function linkOpensInApp(href: string): boolean {
  if (!isDesktop()) return false;
  const description = describeLink(href);
  return description?.isGitHub === true && description.label != null;
}

interface MenuState {
  x: number;
  y: number;
  url: string;
}

function LinkMenu({
  menu,
  inApp,
  inPullRequestPane,
  onOpenInApp,
  onOpenInPullRequestPane,
  onClose,
}: {
  menu: MenuState;
  inApp: boolean;
  // The link names the pull request of the chat's own repository, so the pane
  // can show it; the menu offers that target next to the browser.
  inPullRequestPane: boolean;
  onOpenInApp: (url: string) => void;
  onOpenInPullRequestPane: (url: string) => void;
  onClose: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, []);

  useEffect(() => {
    const dismiss = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !listRef.current?.contains(event.target)) onClose();
    };
    // Capture, so a click that another control consumes still dismisses.
    document.addEventListener('mousedown', dismiss, true);
    return () => {
      document.removeEventListener('mousedown', dismiss, true);
    };
  }, [onClose]);

  const items: { label: string; run: () => void }[] = [
    ...(inPullRequestPane
      ? [
          {
            label: 'Open in pull requests',
            run: () => {
              onOpenInPullRequestPane(menu.url);
            },
          },
        ]
      : []),
    ...(inApp
      ? [
          {
            label: parsePullRequestLink(menu.url) ? 'Open in browser' : 'Open in app browser',
            run: () => {
              onOpenInApp(menu.url);
            },
          },
        ]
      : []),
    {
      label: 'Open in default browser',
      run: () => {
        void openExternal(menu.url);
      },
    },
    {
      label: 'Copy link',
      run: () => {
        void navigator.clipboard.writeText(menu.url);
      },
    },
  ];

  // Keep the menu inside the window when the cursor hugs the edge.
  const x = Math.min(menu.x, window.innerWidth - 220);
  const y = Math.min(menu.y, window.innerHeight - items.length * 34 - 16);

  return (
    <div
      ref={listRef}
      role="menu"
      aria-label="Link actions"
      style={{ left: x, top: y }}
      className="pr-note-enter fixed z-50 min-w-48 rounded-xl bg-raised py-1 shadow-lg"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const buttons = Array.from(
          listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
        );
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'ArrowDown'
            ? (current + 1) % buttons.length
            : (current - 1 + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="flex w-full items-center px-3 py-1.5 text-left text-body text-secondary transition-colors hover:bg-elevated hover:text-primary focus-visible:bg-elevated focus-visible:text-primary"
          onClick={() => {
            onClose();
            item.run();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// One host for every markdown tree in the app: it owns the singleton menu
// and knows the active chat, so the in-app browser opens in the panel the
// user is already looking at.
export function LinkActionsProvider({ children }: { children: ReactNode }) {
  const dispatch = useStoreDispatch();
  const activeAppSessionId = useStoreSelector((state) => state.activeAppSessionId);
  const activeCwd = useStoreSelector((state) => {
    if (!state.activeAppSessionId) return null;
    const sessions: Partial<typeof state.sessions> = state.sessions;
    return sessions[state.activeAppSessionId]?.cwd ?? null;
  });
  // The session view subscribes this same poller for its own surfaces, so the
  // remote lookup a pull request link needs is already cached and fresh.
  const { env } = useGitEnvironment(activeCwd ?? '', 'worktree');
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openInAppBrowser = useCallback(
    (url: string) => {
      if (!activeAppSessionId || !isDesktop()) {
        void openExternal(url);
        return;
      }
      dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'browser', appSessionId: activeAppSessionId });
      openBrowser({ appSessionId: activeAppSessionId, url });
    },
    [dispatch, activeAppSessionId],
  );

  const openInPullRequestPane = useCallback(
    (url: string) => {
      const target = resolvePullRequestPaneTarget(url, activeCwd, env?.remoteUrl ?? null);
      if (!target || !activeAppSessionId || !isDesktop()) {
        openInAppBrowser(url);
        return;
      }
      // The id names the pull request, so a second click on the same link
      // reactivates the open tab instead of piling up duplicates.
      dispatch({
        type: 'OPEN_UTILITY_TOOL',
        tool: 'pull-request',
        appSessionId: activeAppSessionId,
        tabId: `pr:${target.cwd}:${String(target.number)}`,
        cwd: target.cwd,
        prNumber: target.number,
        label: `PR #${String(target.number)}`,
      });
    },
    [dispatch, activeAppSessionId, activeCwd, env, openInAppBrowser],
  );

  const openLink = useCallback(
    (url: string) => {
      if (parsePullRequestLink(url)) {
        openInPullRequestPane(url);
        return;
      }
      openInAppBrowser(url);
    },
    [openInPullRequestPane, openInAppBrowser],
  );

  const actions = useMemo<LinkActions>(
    () => ({
      openLink,
      openInAppBrowser,
      openMenu: (position, url) => {
        setMenu({ x: position.x, y: position.y, url });
      },
    }),
    [openLink, openInAppBrowser],
  );

  return (
    <LinkActionsContext.Provider value={actions}>
      {children}
      {menu ? (
        <LinkMenu
          menu={menu}
          inApp={linkOpensInApp(menu.url)}
          inPullRequestPane={
            resolvePullRequestPaneTarget(menu.url, activeCwd, env?.remoteUrl ?? null) !== null
          }
          onOpenInApp={openInAppBrowser}
          onOpenInPullRequestPane={openInPullRequestPane}
          onClose={() => {
            setMenu(null);
          }}
        />
      ) : null}
    </LinkActionsContext.Provider>
  );
}

// Called from the markdown anchor renderer; returns whether the click was
// taken over, so plain links keep their native behavior untouched.
export function interceptLinkClick(
  event: ReactMouseEvent<HTMLAnchorElement>,
  href: string,
  actions: LinkActions | null,
): boolean {
  if (!actions || !linkOpensInApp(href)) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  event.preventDefault();
  actions.openLink(href);
  return true;
}
