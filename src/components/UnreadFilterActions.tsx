import { Bell } from 'lucide-react';

interface UnreadFilterActionsProps {
  unreadOnly: boolean;
  unreadCount: number;
  onToggleUnread: () => void;
  onMarkAllRead: () => void;
}

export function UnreadFilterActions({
  unreadOnly,
  unreadCount,
  onToggleUnread,
  onMarkAllRead,
}: UnreadFilterActionsProps) {
  return (
    <>
      {unreadOnly && unreadCount > 0 && (
        <button
          type="button"
          onClick={onMarkAllRead}
          className="cursor-pointer rounded-sm px-2 py-1.5 text-[11px] font-medium text-muted transition-colors hover:text-primary"
        >
          Mark all as read
        </button>
      )}
      <button
        type="button"
        onClick={onToggleUnread}
        title={unreadOnly ? 'Show all sessions' : 'Show unread only'}
        aria-label={unreadOnly ? 'Show all sessions' : 'Show unread only'}
        aria-pressed={unreadOnly}
        className={`relative cursor-pointer rounded-sm p-1.5 transition-colors ${
          unreadOnly ? 'text-accent' : 'text-muted hover:text-primary'
        }`}
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[11px] font-semibold leading-none tabular-nums text-bg">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </>
  );
}
