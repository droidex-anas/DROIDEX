// What the next prompt carries beside its words: answers picked in a side chat
// and frames added from the chat's canvas. Both sit as chips on the draft's
// first line, go with the prompt however it is sent, and come back when a
// queued prompt is edited. A prompt to a child carries neither.

import { Frame } from 'lucide-react';
import { MessageThread } from '@droidex/icons';
import {
  canvasContextOf,
  promptWithFramePins,
  restoreFramePins,
  unpinFrames,
  useFramePins,
  type FramePin,
} from '../../features/canvas/framePins';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import type { QueuedPrompt } from '../../lib/promptQueue';
import { promptWithSideChatReplies, sideChatPanel } from '../../lib/sideChats';
import type { DraftSelection } from './DraftSelections';

const NO_REPLIES: string[] = [];
const NO_PINS: readonly FramePin[] = [];

export function useComposerReferences(appSessionId: string | null, toChild: boolean) {
  const dispatch = useStoreDispatch();
  const attachedReplies = useStoreSelector((state) =>
    appSessionId ? sideChatPanel(state.sideChats, appSessionId).attachedReplies : undefined,
  );
  const pinned = useFramePins(appSessionId);
  const sideChatReplies = toChild ? NO_REPLIES : (attachedReplies ?? NO_REPLIES);
  const framePins = toChild ? NO_PINS : pinned;

  const detachReplies = () => {
    if (!appSessionId || sideChatReplies.length === 0) return;
    dispatch({
      type: 'DETACH_SIDE_CHAT_REPLIES',
      sourceAppSessionId: appSessionId,
      replies: sideChatReplies,
    });
  };
  const unpin = (pins: readonly FramePin[]) => {
    if (appSessionId) unpinFrames(appSessionId, pins);
  };

  const chips: DraftSelection[] = framePins.map((pin) => ({
    key: `frame:${pin.designId}`,
    icon: Frame,
    label: `${pin.name} · ${pin.size}`,
    removeLabel: `Remove ${pin.name}`,
    onRemove: () => {
      unpin([pin]);
    },
  }));
  if (sideChatReplies.length > 0)
    chips.unshift({
      key: 'side-chat-replies',
      icon: MessageThread,
      label:
        sideChatReplies.length === 1 ? '1 message' : `${String(sideChatReplies.length)} messages`,
      removeLabel: 'Remove side chat answers',
      onRemove: detachReplies,
    });

  return {
    chips,
    sideChatReplies,
    /** The fields a queued prompt keeps them in. */
    queued: {
      ...(sideChatReplies.length > 0 ? { sideChatReplies } : {}),
      ...(framePins.length > 0 ? { framePins } : {}),
    } satisfies Partial<QueuedPrompt>,
    canvasContext: canvasContextOf(framePins),
    /** The text the agent receives: the user's words, then what goes with them. */
    compose: (prompt: string) =>
      promptWithFramePins(promptWithSideChatReplies(prompt, sideChatReplies), framePins),
    /** The fields the sent prompt's bubble shows them from. */
    transcript: {
      ...(sideChatReplies.length > 0 ? { sideChatReplies } : {}),
      ...(framePins.length > 0 ? { canvasFrames: framePins.map((pin) => pin.name) } : {}),
    },
    /** Takes them off the draft once its prompt has gone. */
    detach: () => {
      detachReplies();
      unpin(framePins);
    },
    /** Backspace on an empty draft takes the last chip off; false when there was none. */
    removeLast: (): boolean => {
      const last = framePins.at(-1);
      if (last) unpin([last]);
      else if (sideChatReplies.length > 0) detachReplies();
      return last !== undefined || sideChatReplies.length > 0;
    },
    restore: (prompt: QueuedPrompt) => {
      if (!appSessionId) return;
      for (const reply of prompt.sideChatReplies ?? [])
        dispatch({ type: 'ATTACH_SIDE_CHAT_REPLY', sourceAppSessionId: appSessionId, reply });
      if (prompt.framePins) restoreFramePins(appSessionId, prompt.framePins);
    },
  };
}
