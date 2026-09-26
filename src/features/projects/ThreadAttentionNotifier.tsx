import { useThreadAttentionNotifications } from './useThreadAttentionNotifications';

/* Mounted only once a project exists, so a window that never opens one pays
   nothing for the watcher. It renders nothing; the hook does the work. */
export function ThreadAttentionNotifier() {
  useThreadAttentionNotifications();
  return null;
}
