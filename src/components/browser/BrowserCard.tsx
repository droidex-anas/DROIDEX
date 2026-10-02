import { useRef, useState } from 'react';
import { Ellipsis, ExternalLink, Link } from '@droidex/icons';
import { useStoreDispatch } from '../../hooks/useStore';
import { browserPageOf, browserStepInFlight } from '../../lib/browserTools';
import { describeLink } from '../../lib/linkPresentation';
import { openExternal } from '../../lib/onboarding';
import { toast } from '../../lib/toast';
import type { TranscriptEvent } from '../../types/bridge';
import { Popover } from '../environment/Popover';
import { LinkBadge } from '../transcript/LinkBadge';

const MENU_ROW =
  'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-droid-text-secondary transition-colors hover:bg-droid-elevated/60 hover:text-droid-text focus-visible:bg-droid-elevated/60 focus-visible:text-droid-text focus-visible:outline-none';

/**
 * The page a turn worked on in the chat's browser, as one card in the
 * transcript. It names the page, opens it in the Browser pane, and while the
 * agent is on the page its second line says what the agent is doing there.
 * The line keeps its place when the work ends, so the transcript does not move.
 */
export function BrowserCard({
  events,
  working,
}: {
  /** The turn's browser calls and their results, in order. */
  events: TranscriptEvent[];
  /** The turn is still running. */
  working: boolean;
}) {
  const dispatch = useStoreDispatch();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const page = browserPageOf(events);
  const link = page ? describeLink(page.url) : null;
  const host = link?.host.replace(/^www\./, '');
  const step = working ? browserStepInFlight(events) : null;
  // An address reads as its site while it is being opened.
  const doing = step && `${step.liveVerb} ${describeLink(step.object)?.host ?? step.object}`.trim();

  const copyLink = (url: string) => {
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Link copied'))
      .catch(() => toast.error('Could not copy to the clipboard.'));
  };

  return (
    <div className="my-1.5 flex w-[360px] max-w-full items-center gap-1 rounded-2xl border border-droid-border bg-droid-surface py-2.5 pl-3.5 pr-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-droid-text">
          {page?.title ?? host ?? 'Browser'}
        </div>
        <div className="mt-0.5 flex items-center text-[12px] text-droid-text-muted">
          {doing ? (
            <span className="shimmer-text truncate font-medium">{doing}</span>
          ) : (
            <>
              {link && <LinkBadge key={link.host} link={link} />}
              <span className="truncate">{host ? `${host} · Browser` : 'No page yet'}</span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'browser' });
        }}
        className="shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-medium text-droid-text-secondary transition-colors hover:bg-droid-elevated hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
      >
        Open
      </button>
      {page && (
        <>
          <button
            ref={menuRef}
            type="button"
            aria-label="Page options"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
            className={`shrink-0 rounded-lg p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60 ${
              menuOpen
                ? 'bg-droid-elevated text-droid-text'
                : 'text-droid-text-muted hover:bg-droid-elevated hover:text-droid-text'
            }`}
          >
            <Ellipsis className="h-4 w-4" />
          </button>
          <Popover
            open={menuOpen}
            onClose={() => {
              setMenuOpen(false);
            }}
            anchorRef={menuRef}
            label="Page options"
            width={220}
          >
            <div className="p-1">
              <button
                type="button"
                className={MENU_ROW}
                onClick={() => {
                  copyLink(page.url);
                  setMenuOpen(false);
                }}
              >
                <Link className="h-3.5 w-3.5 shrink-0" />
                Copy link
              </button>
              <button
                type="button"
                className={MENU_ROW}
                onClick={() => {
                  void openExternal(page.url);
                  setMenuOpen(false);
                }}
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                Open in default browser
              </button>
            </div>
          </Popover>
        </>
      )}
    </div>
  );
}
