import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Spinner } from '@droidex/icons';
import { worktreeName } from '../lib/git';
import { worktreeChatStatus } from '../lib/worktreeSettings';
import type { SessionSummary } from '../types/bridge';
import type { GitWorktree, PullRequest } from '../types/vcs';
import { PrStateIcon } from './environment/GithubIcons';
import { Badge } from './ui/Badge';

function ChatStatus({
  session,
  activeAppSessionId,
}: {
  session: SessionSummary;
  activeAppSessionId: string | null;
}) {
  const label = worktreeChatStatus(session, activeAppSessionId);
  return (
    <span className="rounded-xs bg-elevated px-1.5 py-0.5 text-caption text-muted">{label}</span>
  );
}

function WorktreeAction({
  worktree,
  isInUse,
  checking,
  removing,
  onRequestRemoval,
}: {
  worktree: GitWorktree;
  isInUse: boolean;
  checking: string | null;
  removing: string | null;
  onRequestRemoval: () => void;
}) {
  if (isInUse) {
    return <Badge title="An open or working chat is using this worktree">in use</Badge>;
  }
  return (
    <button
      onClick={onRequestRemoval}
      disabled={removing !== null || checking !== null}
      title="Remove worktree"
      className="shrink-0 rounded-sm px-2 py-1 text-label text-muted transition duration-150 hover:bg-danger-soft hover:text-danger enabled:active:scale-97 disabled:opacity-40"
    >
      {checking === worktree.path || removing === worktree.path ? (
        <Spinner className="size-3 motion-safe:animate-spin-slow" />
      ) : (
        'Delete'
      )}
    </button>
  );
}

function WorktreeSummary({
  worktree,
  pullRequest,
  linkedSessionCount,
  isMerged,
  isExpanded,
  onToggle,
}: {
  worktree: GitWorktree;
  pullRequest: PullRequest | null;
  linkedSessionCount: number;
  isMerged: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={linkedSessionCount === 0}
      aria-expanded={linkedSessionCount > 0 ? isExpanded : undefined}
      className="flex min-w-0 flex-1 items-start gap-2.5 text-left transition-opacity duration-150 active:opacity-70 disabled:cursor-default"
    >
      <ChevronRight
        className={`mt-0.5 size-icon-sm shrink-0 text-muted transition-transform duration-200 ${
          isExpanded ? 'rotate-90' : ''
        } ${linkedSessionCount === 0 ? 'invisible' : ''}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-body-strong text-primary">{worktreeName(worktree)}</span>
          {isMerged && <PrStateIcon kind="merged" size={14} />}
          {pullRequest && (
            <Badge>
              #{pullRequest.number}{' '}
              {pullRequest.isDraft ? 'draft' : pullRequest.state.toLowerCase()}
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block truncate text-caption text-muted">{worktree.path}</span>
        {linkedSessionCount > 0 && (
          <span className="mt-1 block text-caption text-muted">
            {String(linkedSessionCount)}{' '}
            {linkedSessionCount === 1 ? 'conversation' : 'conversations'}
          </span>
        )}
      </span>
    </button>
  );
}

function ConversationList({
  linkedSessions,
  activeAppSessionId,
  onOpenChat,
}: {
  linkedSessions: SessionSummary[];
  activeAppSessionId: string | null;
  onOpenChat: (appSessionId: string) => void;
}) {
  return (
    <div className="ml-6 mt-2 border-l border-divider pl-2.5">
      {linkedSessions.map((session) => (
        <motion.button
          key={session.appSessionId}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={() => {
            onOpenChat(session.appSessionId);
          }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-150 hover:bg-elevated active:bg-active"
        >
          <span className="min-w-0 flex-1 truncate text-label text-secondary">{session.title}</span>
          <ChatStatus session={session} activeAppSessionId={activeAppSessionId} />
        </motion.button>
      ))}
    </div>
  );
}

export function WorktreeSettingsRow({
  worktree,
  pullRequest,
  linkedSessions,
  activeAppSessionId,
  isMerged,
  isInUse,
  isExpanded,
  checking,
  removing,
  onRequestRemoval,
  onToggle,
  onOpenChat,
}: {
  worktree: GitWorktree;
  pullRequest: PullRequest | null;
  linkedSessions: SessionSummary[];
  activeAppSessionId: string | null;
  isMerged: boolean;
  isInUse: boolean;
  isExpanded: boolean;
  checking: string | null;
  removing: string | null;
  onRequestRemoval: () => void;
  onToggle: () => void;
  onOpenChat: (appSessionId: string) => void;
}) {
  const linkedSessionCount = linkedSessions.length;
  return (
    <motion.div
      layout="position"
      transition={{ layout: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }}
      className="group px-3.5 py-3"
    >
      <div className="flex items-start gap-2">
        <WorktreeSummary
          worktree={worktree}
          pullRequest={pullRequest}
          linkedSessionCount={linkedSessionCount}
          isMerged={isMerged}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
        <WorktreeAction
          worktree={worktree}
          isInUse={isInUse}
          checking={checking}
          removing={removing}
          onRequestRemoval={onRequestRemoval}
        />
      </div>

      <AnimatePresence initial={false}>
        {isExpanded && linkedSessions.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <ConversationList
              linkedSessions={linkedSessions}
              activeAppSessionId={activeAppSessionId}
              onOpenChat={onOpenChat}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
