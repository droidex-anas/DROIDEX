// One click on Variants (spec §4): copies of the frame's revision on show,
// placed beside it, and a request that goes straight to the chat's agent with
// only those copies pinned. The composer, and the pins it holds, stay as they are.

import { useCallback, useRef } from 'react';
import { useStoreApi, useStoreDispatch, type AppState } from '../../hooks/useStore';
import { isAppUpdateInstalling } from '../../lib/appUpdate';
import { sendToSession } from '../../lib/commands';
import { addLocalSteer } from '../../lib/localSteers';
import { sessionIsLive } from '../../lib/sessions';
import { toast } from '../../lib/toast';
import { canvasClient } from './canvasClient';
import { canvasMessage, CanvasRequestError } from './client';
import { canvasContextOf, pinOf, promptWithFramePins } from './framePins';
import type { CanvasFrame, CreateFramesInput } from './protocol';
import { variantFrames, variantPrompt, variantSource, type VariantChoice } from './variantRequests';

/** Makes variants of a frame and asks the chat's agent for them; failures show as toasts. */
export function useVariantRequests(
  appSessionId: string,
  canvasId: string,
): (frame: CanvasFrame, choice: VariantChoice) => Promise<void> {
  const store = useStoreApi();
  const dispatch = useStoreDispatch();
  // One set of frames per choice until the sidecar answers, so asking again
  // after a lost reply finds the frames that request reserved, not new ones.
  const attempts = useRef(new Map<string, CreateFramesInput>());

  return useCallback(
    async (frame, choice) => {
      const source = variantSource(canvasId, frame);
      if (!source) return;
      if (isAppUpdateInstalling()) {
        toast.error('DROIDEX is installing an update, so variants wait until it restarts.');
        return;
      }
      const { designId, revisionId } = source.revision;
      const key = `${designId}:${revisionId}:${choice.kind}:${String(choice.count)}`;
      const boardNames = canvasClient.snapshotOf(canvasId)?.frames.map((shown) => shown.name);
      const input =
        attempts.current.get(key) ??
        variantFrames(source, choice.count, crypto.randomUUID(), boardNames ?? []);
      attempts.current.set(key, input);

      let made: CanvasFrame[];
      try {
        made = (await canvasClient.createFrames(appSessionId, canvasId, input)).frames;
        attempts.current.delete(key);
      } catch (failure) {
        // A refusal reserved nothing, so the next click is a new request.
        if (failure instanceof CanvasRequestError) attempts.current.delete(key);
        toast.error(`Couldn’t make variants of ${source.name}. ${canvasMessage(failure)}`);
        return;
      }

      const state = store.getState();
      const sessions: Partial<AppState['sessions']> = state.sessions;
      const session = sessions[appSessionId];
      if (!session || state.canvasAttachments[appSessionId] !== canvasId) {
        toast.error('This chat has left the canvas, so the variants were made but not requested.');
        return;
      }
      const pins = made.map((variant) => pinOf(canvasId, variant));
      const prompt = variantPrompt(source.name, choice);
      const canvasContext = canvasContextOf(pins);
      const steerId = sessionIsLive(session) ? crypto.randomUUID() : undefined;
      try {
        sendToSession(appSessionId, promptWithFramePins(prompt, pins), { steerId, canvasContext });
      } catch (failure) {
        toast.error(`The variants were made but not requested. ${canvasMessage(failure)}`);
        return;
      }
      // A busy agent takes the request as a steer, shown pending until the
      // sidecar lists it. An idle one starts a turn, and the sidecar does not
      // echo a prompt back, so the chat shows it from here.
      if (steerId)
        addLocalSteer(
          appSessionId,
          { id: steerId, text: prompt, sentAt: Date.now() },
          { id: steerId, text: prompt, skills: [], files: [], framePins: pins, canvasContext },
        );
      else
        dispatch({
          type: 'SESSION_TRANSCRIPT',
          event: {
            id: `local-${String(Date.now())}`,
            appSessionId,
            sourceSessionId: 'user',
            role: 'primary',
            ts: Date.now(),
            kind: 'text',
            text: prompt,
            author: 'user',
            canvasFrames: pins.map((pin) => pin.name),
          },
        });
    },
    [appSessionId, canvasId, dispatch, store],
  );
}
