import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Spinner } from '@droidex/icons';
import { MAX_CHAT_TITLE_LENGTH } from '../lib/chatMetadata';
import { formatRelativeTime } from '../lib/time';
import { SESSION_MENU_WIDTH } from './SessionContextMenu';
import type { SessionSummary } from '../types/bridge';
import type { SessionAttentionKind } from '../lib/sessionAttention';
import { ACTIVITY_LABELS, type SessionActivityStatus } from '../lib/sidebarActivity';
import { ActivityStatusGlyph, ActivityToggleGlyph } from './ActivityStatusGlyph';
import { PrStateIcon } from './environment/GithubIcons';
import { ModelIcon, type Provider } from './ModelIcon';
import { PROVIDER_LABELS, PROVIDER_MARKS } from '../features/providers/providerIdentity';
import type { PrKind } from '../lib/github';
import type { PrChecksRollup } from '../types/vcs';

const AutomationSessionBadge = lazy(async () => {
  const module = await import('../features/automations/AutomationSessionBadge');
  return { default: module.AutomationSessionBadge };
});

// Row controls are bare icons: hover brightens the glyph instead of adding a
// filled square on top of the row's own hover tint.
const HOVER_ACTION =
  'absolute top-1/2 -translate-y-1/2 flex w-6 h-6 cursor-pointer items-center justify-center rounded-md text-droid-text-muted opacity-0 pointer-events-none transition-[opacity,color] hover:text-droid-text group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60';

// A blocked chat cannot move until the user acts, so list rows still mark it.
const WAITING_ON_USER: ReadonlySet<SessionActivityStatus> = new Set(['approval', 'input', 'plan']);

// Hover-swapped slots hide while the row's own hover controls take their place.
const HIDE_ON_HOVER = 'group-hover:invisible group-focus-within:invisible';

// Sits in the row's trailing slot, where the "..." menu trigger takes its
// place on hover.
function HarnessMark({ provider, label }: { provider: Provider; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`harness-mark flex shrink-0 text-droid-text-muted ${HIDE_ON_HOVER}`}
    >
      <ModelIcon provider={provider} size={14} />
    </span>
  );
}

export interface SessionRowProps {
  session: SessionSummary;
  // Effective title: the app-level rename override when set, else the
  // harness-generated title. Resolved by the parent (see lib/chatMetadata).
  title: string;
  active: boolean;
  unread: boolean;
  running: boolean;
  attention: SessionAttentionKind | null;
  activityStatus: SessionActivityStatus;
  // Activity view only: a second line saying why the chat is listed.
  detail?: string;
  // Linked pull request state, with its check rollup as the icon's dot. List
  // rows lead with it; inbox rows show it beside the title.
  pr?: { kind: PrKind; checks?: PrChecksRollup | null };
  renaming: boolean;
  now: number;
  onSelect: (appSessionId: string) => void;
  onMenu: (appSessionId: string, position: { x: number; y: number }) => void;
  onRenameCommit: (appSessionId: string, title: string) => void;
  onRenameCancel: () => void;
  // Activity view only: the status mark doubles as a control that settles the
  // chat, or reopens a settled one. Absent when the chat cannot be settled.
  onToggleSettled?: (session: SessionSummary) => void;
}

export function areSessionRowPropsEqual(prev: SessionRowProps, next: SessionRowProps): boolean {
  return (
    prev.session.appSessionId === next.session.appSessionId &&
    prev.title === next.title &&
    prev.session.updatedAt === next.session.updatedAt &&
    prev.active === next.active &&
    prev.unread === next.unread &&
    prev.running === next.running &&
    prev.attention === next.attention &&
    prev.activityStatus === next.activityStatus &&
    prev.detail === next.detail &&
    prev.pr?.kind === next.pr?.kind &&
    prev.pr?.checks === next.pr?.checks &&
    prev.renaming === next.renaming &&
    prev.now === next.now &&
    prev.onSelect === next.onSelect &&
    prev.onMenu === next.onMenu &&
    prev.onRenameCommit === next.onRenameCommit &&
    prev.onRenameCancel === next.onRenameCancel &&
    prev.onToggleSettled === next.onToggleSettled
  );
}

// `running` is derived by the parent so this row can skip unrelated store updates.
export const SessionRow = memo(function SessionRow({
  session,
  title,
  active,
  unread,
  running,
  attention,
  activityStatus,
  detail,
  pr,
  renaming,
  now,
  onSelect,
  onMenu,
  onRenameCommit,
  onRenameCancel,
  onToggleSettled,
}: SessionRowProps) {
  // Set once Enter/Escape settles the edit so the blur that follows the
  // input's unmount does not commit (or commit twice). Reset on every focus.
  const renameHandled = useRef(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  const rowButtonRef = useRef<HTMLButtonElement>(null);
  const wasRenaming = useRef(false);
  const [marqueePx, setMarqueePx] = useState(0);
  const timeLabel = formatRelativeTime(session.updatedAt, now);
  // Every row names the harness in the trailing slot. Inbox rows lead with
  // their state and add a second line saying why the chat is listed.
  const inbox = detail !== undefined;
  const working = running && !attention;
  const settled = activityStatus === 'settled';
  const harnessMark = (
    <HarnessMark
      provider={PROVIDER_MARKS[session.provider]}
      label={`${PROVIDER_LABELS[session.provider]} chat`}
    />
  );
  const timeTone = unread ? 'text-droid-text font-medium' : 'text-droid-text-muted';

  // Return focus to the row when the inline editor closes, unless the user
  // already moved focus elsewhere (e.g. clicked another row).
  useEffect(() => {
    if (wasRenaming.current && !renaming && document.activeElement === document.body) {
      rowButtonRef.current?.focus();
    }
    wasRenaming.current = renaming;
  }, [renaming]);

  // A title longer than the sidebar rests truncated ("name…"); hovering the
  // row sweeps it left to reveal the full name, then slides back. The travel
  // distance and duration are per-row CSS vars measured on hover (fonts and
  // sidebar width can change between renders, so measure fresh every time).
  const handleMarqueeEnter = () => {
    const el = titleRef.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const px = el.scrollWidth - el.clientWidth;
    if (px <= 4) return;
    el.style.setProperty('--title-marquee-x', `${String(-px)}px`);
    el.style.setProperty('--title-marquee-duration', `${String(Math.min(10, 2.5 + px / 50))}s`);
    setMarqueePx(px);
  };
  const handleMarqueeLeave = () => {
    setMarqueePx(0);
    const el = titleRef.current;
    el?.style.removeProperty('--title-marquee-x');
    el?.style.removeProperty('--title-marquee-duration');
  };
  const marquee = marqueePx > 0;
  // Scale the right-edge fade with the overflow so a barely-overflowing title
  // is not revealed entirely inside the faded zone.
  const marqueeFade = Math.min(20, Math.max(6, Math.round(marqueePx / 2)));

  // Rename mode swaps the row for an inline editor: Enter/blur commits, Escape
  // cancels. A blank commit clears the override (back to the generated title).
  if (renaming) {
    return (
      <div className="flex items-center gap-2.5 pl-3 pr-2 py-1.5">
        <span className="w-3.5 shrink-0" />
        <input
          autoFocus
          defaultValue={title}
          maxLength={MAX_CHAT_TITLE_LENGTH}
          aria-label={`Rename ${title}`}
          onFocus={(e) => {
            renameHandled.current = false;
            e.currentTarget.select();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              renameHandled.current = true;
              onRenameCommit(session.appSessionId, e.currentTarget.value);
            } else if (e.key === 'Escape') {
              // The menu closes before rename starts, so no other escape layer
              // is open and this Escape always reaches the input.
              renameHandled.current = true;
              onRenameCancel();
            }
          }}
          onBlur={(e) => {
            if (!renameHandled.current) onRenameCommit(session.appSessionId, e.currentTarget.value);
          }}
          className="min-w-0 flex-1 rounded-md bg-droid-elevated px-1.5 py-0.5 text-[13px] text-droid-text ring-1 ring-droid-accent/50 focus:outline-none"
        />
      </div>
    );
  }

  const prIcon = pr && <PrStateIcon kind={pr.kind} size={14} checks={pr.checks} />;
  const spinner = (
    <Spinner size={14} className="shrink-0 motion-safe:animate-spin-slow" aria-label="working" />
  );

  const leadingMark = () => {
    if (inbox) {
      if (working) return spinner;
      // The mark yields to the settle control on hover when the chat can be settled.
      return (
        <ActivityStatusGlyph
          status={activityStatus}
          className={onToggleSettled ? 'inbox-mark' : ''}
        />
      );
    }
    // List rows keep the slot for live state and the linked PR: a working
    // chat spins and reveals its PR on hover; an idle one shows the PR.
    if (working && prIcon) {
      return (
        <span className="relative flex">
          <span className="flex transition-opacity group-hover:opacity-0">{spinner}</span>
          <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
            {prIcon}
          </span>
        </span>
      );
    }
    if (working) return spinner;
    if (WAITING_ON_USER.has(activityStatus)) return <ActivityStatusGlyph status={activityStatus} />;
    return prIcon;
  };

  const titleLine = (
    <span
      className="block min-w-0 flex-1 overflow-hidden"
      style={
        marquee
          ? // Fade the right edge so the sliding title never collides with
            // the hover "..." button.
            {
              maskImage: `linear-gradient(to right, black calc(100% - ${String(marqueeFade)}px), transparent)`,
              WebkitMaskImage: `linear-gradient(to right, black calc(100% - ${String(marqueeFade)}px), transparent)`,
            }
          : undefined
      }
    >
      <span
        ref={titleRef}
        className={`block text-[13px] ${marquee ? 'title-marquee whitespace-nowrap' : 'truncate'} ${
          active || unread
            ? 'text-droid-text'
            : 'text-droid-text-secondary group-hover:text-droid-text'
        } ${unread && !active ? 'font-semibold' : ''}`}
      >
        {title}
      </span>
    </span>
  );

  return (
    <div
      className="group relative"
      onMouseEnter={handleMarqueeEnter}
      onMouseLeave={handleMarqueeLeave}
    >
      <button
        ref={rowButtonRef}
        data-testid="session-row"
        data-app-session-id={session.appSessionId}
        title={`${title} · ${ACTIVITY_LABELS[activityStatus]}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => {
          onSelect(session.appSessionId);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(session.appSessionId, { x: e.clientX, y: e.clientY });
        }}
        className={`w-full flex cursor-pointer ${inbox ? 'items-start py-2.5' : 'items-center py-[7px]'} gap-2.5 pl-3 pr-3 rounded-xl text-left transition-colors ${
          active ? 'bg-droid-active' : 'hover:bg-droid-elevated/40'
        }`}
      >
        {/* On two-line rows the mark sits in a box the height of the title
            line, so it aligns with the title rather than between the lines. */}
        <span
          className={`flex w-3.5 shrink-0 items-center justify-center ${inbox ? 'h-5' : ''} ${
            active ? 'text-droid-text' : 'text-droid-text-secondary group-hover:text-droid-text'
          }`}
        >
          {leadingMark()}
        </span>
        {unread && <span className="sr-only">Unread:</span>}
        {inbox ? (
          <span className="min-w-0 flex-1">
            <span className="flex h-5 min-w-0 items-center gap-2">
              {titleLine}
              <Suspense fallback={null}>
                <AutomationSessionBadge appSessionId={session.appSessionId} />
              </Suspense>
              {prIcon}
              {harnessMark}
            </span>
            {/* While the chat works its live activity shimmers across the whole
                line; otherwise the reason shares it with the time. */}
            <span className="mt-1 flex min-w-0 items-center gap-2 text-[12px] leading-4 text-droid-text-muted">
              <span className={`min-w-0 flex-1 truncate ${working ? 'shimmer-text' : ''}`}>
                {detail}
              </span>
              {!working && <span className={`shrink-0 tabular-nums ${timeTone}`}>{timeLabel}</span>}
            </span>
          </span>
        ) : (
          <>
            {titleLine}
            <Suspense fallback={null}>
              <AutomationSessionBadge appSessionId={session.appSessionId} />
            </Suspense>
            <span className="ml-1 flex shrink-0 items-center gap-2">
              <span className={`w-[30px] text-right text-[12px] tabular-nums ${timeTone}`}>
                {timeLabel}
              </span>
              {harnessMark}
            </span>
          </>
        )}
      </button>
      {/* In the inbox the status mark becomes the settle control on hover: one
          click closes a task without the menu; on a settled row it reopens. */}
      {onToggleSettled && !working && (
        <button
          type="button"
          aria-label={settled ? `Reopen ${title}` : `Mark ${title} as settled`}
          title={settled ? 'Reopen task' : 'Mark as settled'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSettled(session);
          }}
          className={`${HOVER_ACTION} inbox-mark-control left-[7px] ${inbox ? 'top-2 translate-y-0' : ''} ${
            settled ? 'hover:text-droid-text' : 'hover:text-droid-green'
          }`}
        >
          <ActivityToggleGlyph settled={settled} />
        </button>
      )}
      {/* On hover the trailing harness mark becomes the "..." menu trigger.
          It stays tabbable while hidden so keyboard users can reach it;
          opacity (not display) keeps it in the tab order. */}
      <button
        type="button"
        aria-label={`Actions for ${title}`}
        title="Chat actions"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          onMenu(session.appSessionId, { x: rect.right - SESSION_MENU_WIDTH, y: rect.bottom + 4 });
        }}
        className={`${HOVER_ACTION} right-[7px] ${inbox ? 'top-2 translate-y-0' : ''}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
    </div>
  );
}, areSessionRowPropsEqual);
