import { useEffect, useState } from 'react';
import { isRemoteClient } from '../../lib/desktop';
import { dismissSidebarCard, loadSidebarCardSeen } from '../../lib/sidebarCards';

/** The Remote launch card's id among the sidebar's one-time announcements. */
export const REMOTE_LAUNCH_CARD_ID = 'remote-launch';

// The Remote launch card shows once the user has no other announcement up
// (`held`) and has not claimed a username yet. A claimed username, the call to
// action, or the close button retire it for good. A browser running Remote is
// already past the pitch, so it never sees the card.
export function useRemoteLaunchCard(held: boolean) {
  const [unseen, setUnseen] = useState(
    () => !isRemoteClient() && !loadSidebarCardSeen(REMOTE_LAUNCH_CARD_ID),
  );
  const [usernameClaimed, setUsernameClaimed] = useState<boolean | null>(null);

  const retire = () => {
    setUnseen(false);
    dismissSidebarCard(REMOTE_LAUNCH_CARD_ID);
  };

  useEffect(() => {
    const api = window.droidex;
    if (!unseen || !api) return;
    let active = true;
    const apply = (username: string) => {
      if (active) setUsernameClaimed(username !== '');
    };
    const unsubscribe = api.onRemoteState((state) => {
      apply(state.profile.username);
    });
    api.getRemoteState().then(
      (state) => {
        apply(state.profile.username);
      },
      () => {
        // Remote is unavailable, so there is nothing to announce yet.
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [unseen]);

  useEffect(() => {
    if (unseen && usernameClaimed) retire();
  }, [unseen, usernameClaimed]);

  return { visible: unseen && usernameClaimed === false && !held, retire };
}
