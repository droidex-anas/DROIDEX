import {
  createContext,
  useCallback,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Browser, Copy, ExternalLink, GitPullRequest } from '@droidex/icons';

import { useGitEnvironment } from '../hooks/useGitEnvironment';
import { useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { openBrowser } from '../lib/commands';
import { isDesktop } from '../lib/desktop';
import { getGitEnvironment } from '../lib/git';
import { describeLink } from '../lib/linkPresentation';
import { openExternal } from '../lib/onboarding';
import { comparablePath } from '../lib/pathComparison';
import { Menu } from './ui/Menu';
import type { AnchorPoint } from './ui/usePopoverPosition';
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
  // The link element takes focus back when the menu closes.
  openMenu: (link: HTMLElement, point: AnchorPoint, url: string) => void;
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
  point: AnchorPoint;
  url: string;
}

// The right-click menu for a link, opened at the pointer. It is the shared
// Menu, so arrows, type-ahead, Tab and Escape behave as everywhere else and
// focus returns to the link on close.
function LinkMenu({
  menu,
  anchorRef,
  inApp,
  inPullRequestPane,
  onOpenInApp,
  onOpenInPullRequestPane,
  onClose,
}: {
  menu: MenuState | null;
  anchorRef: RefObject<HTMLElement | null>;
  inApp: boolean;
  // The link names the pull request of the chat's own repository, so the pane
  // can show it; the menu offers that target next to the browser.
  inPullRequestPane: boolean;
  onOpenInApp: (url: string) => void;
  onOpenInPullRequestPane: (url: string) => void;
  onClose: () => void;
}) {
  const url = menu?.url ?? '';
  return (
    <Menu
      open={menu !== null}
      onClose={onClose}
      anchorRef={anchorRef}
      anchorPoint={menu?.point}
      label="Link actions"
      width={232}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      {inPullRequestPane ? (
        <Menu.Item
          icon={GitPullRequest}
          onSelect={() => {
            onOpenInPullRequestPane(url);
          }}
        >
          Open in pull requests
        </Menu.Item>
      ) : null}
      {inApp ? (
        <Menu.Item
          icon={Browser}
          onSelect={() => {
            onOpenInApp(url);
          }}
        >
          {parsePullRequestLink(url) ? 'Open in browser' : 'Open in app browser'}
        </Menu.Item>
      ) : null}
      <Menu.Item
        icon={ExternalLink}
        onSelect={() => {
          void openExternal(url);
        }}
      >
        Open in default browser
      </Menu.Item>
      <Menu.Item
        icon={Copy}
        onSelect={() => {
          void navigator.clipboard.writeText(url);
        }}
      >
        Copy link
      </Menu.Item>
    </Menu>
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
  const menuAnchorRef = useRef<HTMLElement | null>(null);

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
      if (!activeAppSessionId || !activeCwd || !isDesktop()) {
        openInAppBrowser(url);
        return;
      }
      // Captured so a remote read below lands on the chat that was clicked in.
      const appSessionId = activeAppSessionId;
      const cwd = activeCwd;
      const open = (remoteUrl: string | null) => {
        const target = resolvePullRequestPaneTarget(url, cwd, remoteUrl);
        if (!target) {
          openInAppBrowser(url);
          return;
        }
        // The id names the pull request, so a second click on the same link
        // reactivates the open tab instead of piling up duplicates.
        dispatch({
          type: 'OPEN_UTILITY_TOOL',
          tool: 'pull-request',
          appSessionId,
          tabId: `pr:${comparablePath(target.cwd)}:${String(target.number)}`,
          cwd: target.cwd,
          prNumber: target.number,
          label: `PR #${String(target.number)}`,
        });
      };
      if (env) {
        open(env.remoteUrl ?? null);
        return;
      }
      // Right after a chat switch the shared poller may not have answered yet;
      // read the remote once instead of sending the link to the browser.
      void getGitEnvironment(cwd).then((fresh) => {
        open(fresh.remoteUrl ?? null);
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

  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  const actions = useMemo<LinkActions>(
    () => ({
      openLink,
      openInAppBrowser,
      openMenu: (link, point, url) => {
        menuAnchorRef.current = link;
        setMenu({ point, url });
      },
    }),
    [openLink, openInAppBrowser],
  );

  return (
    <LinkActionsContext.Provider value={actions}>
      {children}
      <LinkMenu
        menu={menu}
        anchorRef={menuAnchorRef}
        inApp={menu ? linkOpensInApp(menu.url) : false}
        inPullRequestPane={
          menu
            ? resolvePullRequestPaneTarget(menu.url, activeCwd, env?.remoteUrl ?? null) !== null
            : false
        }
        onOpenInApp={openInAppBrowser}
        onOpenInPullRequestPane={openInPullRequestPane}
        onClose={closeMenu}
      />
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
