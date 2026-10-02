import { useRef, useState } from 'react';
import { Ellipsis, ExternalLink, Link } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { browserPageOf, browserStepInFlight, isWholeUrl } from '../../lib/browserTools';
import { describeLink } from '../../lib/linkPresentation';
import { openExternal } from '../../lib/onboarding';
import { toast } from '../../lib/toast';
import type { TranscriptEvent } from '../../types/bridge';
import { Popover } from '../environment/Popover';
import { LinkBadge } from '../transcript/LinkBadge';
import { BrowserPreview } from './BrowserPreview';

const MENU_ROW =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-droid-text-secondary transition-colors hover:bg-droid-elevated/60 hover:text-droid-text focus-visible:bg-droid-elevated/60 focus-visible:text-droid-text focus-visible:outline-none';

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
    <div className="my-1.5 w-[360px] max-w-full overflow-hidden rounded-2xl border border-droid-border bg-droid-surface">
      {browserSessionId && (
        <BrowserPreview cardKey={cardKey} browserSessionId={browserSessionId} live={working} />
      )}
      <div className="flex items-center gap-1 py-2.5 pl-3.5 pr-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-droid-text">{title}</div>
          <div className="mt-0.5 flex items-center text-[12px] text-droid-text-muted">
            {doing ? (
              <span className="shimmer-text truncate font-medium">{doing}</span>
            ) : (
              <>
                {link && <LinkBadge key={link.host} link={link} />}
                <span className="truncate">{site}</span>
              </>
            )}
          </div>
        </div>
        {inActiveChat && (
          <button
            type="button"
            onClick={() => {
              dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'browser' });
            }}
            className="shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-medium text-droid-text-secondary transition-colors hover:bg-droid-elevated hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
          >
            Open
          </button>
        )}
        {page && isWholeUrl(page.url) && <PageMenu url={page.url} />}
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
  const step = working ? browserStepInFlight(events) : null;
  return {
    page,
    link,
    title: page?.title ?? host ?? 'Browser page',
    site: host ? `${host} · Browser` : 'Browser',
    // An address reads as its site while it is being opened.
    doing: step && `${step.liveVerb} ${describeLink(step.object)?.host ?? step.object}`.trim(),
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
      <button
        ref={buttonRef}
        type="button"
        aria-label="Page options"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className={`shrink-0 rounded-lg p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60 ${
          open
            ? 'bg-droid-elevated text-droid-text'
            : 'text-droid-text-muted hover:bg-droid-elevated hover:text-droid-text'
        }`}
      >
        <Ellipsis className="h-4 w-4" />
      </button>
      <Popover open={open} onClose={close} anchorRef={buttonRef} label="Page options" width={220}>
        <div className="p-1">
          <button
            type="button"
            className={MENU_ROW}
            onClick={() => {
              void navigator.clipboard
                .writeText(url)
                .then(() => toast.success('Link copied'))
                .catch(() => toast.error('Could not copy to the clipboard.'));
              close();
            }}
          >
            <Link className="h-3.5 w-3.5 shrink-0" />
            Copy link
          </button>
          <button
            type="button"
            className={MENU_ROW}
            onClick={() => {
              void openExternal(url);
              close();
            }}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            Open in default browser
          </button>
        </div>
      </Popover>
    </>
  );
}
