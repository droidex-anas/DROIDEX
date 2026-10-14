import { useRef, useState } from 'react';
import { Ellipsis, ExternalLink, Link } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { browserPageOf, browserStepLabel, isWholeUrl } from '../../lib/browserTools';
import { describeLink } from '../../lib/linkPresentation';
import { openExternal } from '../../lib/onboarding';
import { toast } from '../../lib/toast';
import type { TranscriptEvent } from '../../types/bridge';
import { Button } from '../ui/Button';
import { Menu } from '../ui/Menu';
import { LinkBadge } from '../transcript/LinkBadge';
import { BrowserPreview } from './BrowserPreview';

/**
 * The page a turn worked on in the chat's browser, as one card in the
 * transcript. It names the page, opens it in the Browser pane, and while the
 * agent is on the page its second line says what the agent is doing there.
 * The line keeps its place when the work ends, so the transcript does not move.
 * Above them is a small picture of the page, live while the turn runs.
 */
export function BrowserCard({
  cardKey,
  events,
  working,
}: {
  /** The card's own key in the feed: the picture it last showed is kept by it. */
  cardKey: string;
  /** The turn's browser calls and their results, in order. */
  events: TranscriptEvent[];
  /** The card's turn is still running. */
  working: boolean;
}) {
  const dispatch = useStoreDispatch();
  // Open shows the pane of the chat on screen, so only that chat's cards offer it.
  const appSessionId = events.at(0)?.appSessionId;
  const inActiveChat = useStoreSelector((state) => {
    const active = state.activeAppSessionId;
    if (!active) return false;
    const key = active in state.sessions ? state.sessions[active].appSessionId : active;
    return key === appSessionId;
  });
  const browserSessionId = useStoreSelector((state) =>
    appSessionId && appSessionId in state.browsers
      ? state.browsers[appSessionId].browserSessionId
      : undefined,
  );
  const { page, link, title, site, doing } = cardText(events, working);

  return (
    <div className="my-1.5 w-90 max-w-full overflow-hidden rounded-xl bg-surface">
      <BrowserPreview cardKey={cardKey} browserSessionId={browserSessionId} live={working} />
      <div className="flex items-center gap-1 py-2.5 pl-3.5 pr-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-body-strong text-primary">{title}</div>
          <div className="mt-0.5 flex items-center text-label text-muted">
            {doing ? (
              <span className="shimmer-text truncate">{doing}</span>
            ) : (
              <>
                {link && <LinkBadge key={link.host} link={link} />}
                <span className="truncate">{site}</span>
              </>
            )}
          </div>
        </div>
        {inActiveChat && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'browser' });
            }}
          >
            Open
          </Button>
        )}
        {page && !page.pending && isWholeUrl(page.url) && <PageMenu url={page.url} />}
      </div>
    </div>
  );
}

// What the card says: the page's name, its site, and what the agent is doing
// on it right now. A page the transcript no longer names reads as "Browser page".
function cardText(events: TranscriptEvent[], working: boolean) {
  const page = browserPageOf(events);
  const link = page ? describeLink(page.url) : null;
  const host = link?.host.replace(/^www\./, '');
  return {
    page,
    link,
    title: page?.title ?? host ?? 'Browser page',
    site: host ? `${host} · Browser` : 'Browser',
    doing: working ? browserStepLabel(events) : null,
  };
}

function PageMenu({ url }: { url: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="sm"
        shape="round"
        icon={Ellipsis}
        aria-label="Page options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      />
      <Menu
        open={open}
        onClose={close}
        anchorRef={buttonRef}
        placement="bottom-end"
        label="Page options"
        width={220}
      >
        <Menu.Item
          icon={Link}
          onSelect={() => {
            void navigator.clipboard
              .writeText(url)
              .then(() => toast.success('Link copied'))
              .catch(() => toast.error('Could not copy to the clipboard.'));
          }}
        >
          Copy link
        </Menu.Item>
        <Menu.Item
          icon={ExternalLink}
          onSelect={() => {
            void openExternal(url);
          }}
        >
          Open in default browser
        </Menu.Item>
      </Menu>
    </>
  );
}
