// What the next prompt carries beside its words: answers picked in a side chat,
// frames and elements added from the chat's canvas, and components of its kit.
// All sit as chips on the draft's first line, go with the prompt however it is sent, and come back when a
// queued prompt is edited. A prompt on a canvas also carries the design system
// chosen for it. A prompt to a child carries none of these.

import { createElement } from 'react';
import { Frame } from 'lucide-react';
import { Component, MessageThread, MousePointerSquareDashed } from '@droidex/icons';
import {
  componentLabels,
  componentPinKey,
  pinsUnderKit,
  restoreComponentPins,
  unpinComponents,
  useComponentPins,
  type ComponentPin,
} from '../../features/canvas/componentPins';
import { NEW_CANVAS_KEY, useDesignSystemChoice } from '../../features/canvas/designSystemChoices';
import { ElementCrop } from '../../features/canvas/ElementCrop';
import {
  elementLabel,
  elementName,
  elementPinKey,
  restoreElementPins,
  unpinElements,
  useElementPins,
  type ElementPin,
} from '../../features/canvas/elementPins';
import {
  canvasContextOf,
  promptWithCanvasPins,
  requestDesignSystem,
  restoreFramePins,
  unpinFrames,
  useFramePins,
  type FramePin,
} from '../../features/canvas/framePins';
import { useStoreDispatch, useStoreSelector, type AppState } from '../../hooks/useStore';
import { promptChips, type QueuedPrompt } from '../../lib/promptQueue';
import { promptWithSideChatReplies, sideChatPanel } from '../../lib/sideChats';
import type { DraftSelection } from './DraftSelections';

const NO_REPLIES: string[] = [];
const NO_PINS: readonly FramePin[] = [];
const NO_ELEMENTS: readonly ElementPin[] = [];
const NO_COMPONENTS: readonly ComponentPin[] = [];

/**
 * The canvas a composer's prompt works on: a chat's attached canvas, or the one
 * a design draft chose, or the one its first prompt makes. Null off a canvas.
 */
export function composerCanvasKey(state: AppState, appSessionId: string | null): string | null {
  if (appSessionId) return state.canvasAttachments[appSessionId] ?? null;
  const canvas = state.draftChat?.canvas;
  return canvas ? (canvas.canvasId ?? NEW_CANVAS_KEY) : null;
}

function repliesChip(count: number, onRemove: () => void): DraftSelection {
  return {
    key: 'side-chat-replies',
    icon: MessageThread,
    label: count === 1 ? '1 message' : `${String(count)} messages`,
    removeLabel: 'Remove side chat answers',
    onRemove,
  };
}

export function useComposerReferences(appSessionId: string | null, toChild: boolean) {
  const dispatch = useStoreDispatch();
  const attachedReplies = useStoreSelector((state) =>
    appSessionId ? sideChatPanel(state.sideChats, appSessionId).attachedReplies : undefined,
  );
  const canvasKey = useStoreSelector((state) =>
    toChild ? null : composerCanvasKey(state, appSessionId),
  );
  const designSystem = useDesignSystemChoice(canvasKey);
  const pinned = useFramePins(appSessionId);
  const sideChatReplies = toChild ? NO_REPLIES : (attachedReplies ?? NO_REPLIES);
  const framePins = toChild ? NO_PINS : pinned;
  const pickedElements = useElementPins(appSessionId);
  const elementPins = toChild ? NO_ELEMENTS : pickedElements;
  const chosenKit = designSystem?.ref ?? null;
  const taggedComponents = useComponentPins(appSessionId);
  const requestKit = canvasKey === null ? null : requestDesignSystem(framePins, chosenKit);
  const components = toChild
    ? NO_COMPONENTS
    : pinsUnderKit(taggedComponents, requestKit, designSystem);
  const queued = {
    ...(sideChatReplies.length > 0 ? { sideChatReplies } : {}),
    ...(framePins.length > 0 ? { framePins } : {}),
    ...(elementPins.length > 0 ? { elementPins } : {}),
    ...(components.length > 0 ? { componentPins: components } : {}),
  } satisfies Partial<QueuedPrompt>;
  const labels = componentLabels(components);

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
  const unpinPicked = (pins: readonly ElementPin[]) => {
    if (appSessionId) unpinElements(appSessionId, pins);
  };
  const untag = (pins: readonly ComponentPin[]) => {
    if (appSessionId) unpinComponents(appSessionId, pins);
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
  for (const pin of elementPins) {
    const name = `${elementName(pin.element)} in ${pin.frameName}`;
    chips.push({
      key: `element:${elementPinKey(pin)}`,
      icon: MousePointerSquareDashed,
      thumbnail: createElement(ElementCrop, { pin }),
      label: elementLabel(pin),
      removeLabel: `Remove ${name}`,
      onRemove: () => {
        unpinPicked([pin]);
      },
    });
  }
  components.forEach((pin, index) => {
    chips.push({
      key: `component:${componentPinKey(pin)}`,
      icon: Component,
      label: labels[index],
      removeLabel: `Remove ${labels[index]}`,
      onRemove: () => {
        untag([pin]);
      },
    });
  });
  if (sideChatReplies.length > 0) chips.unshift(repliesChip(sideChatReplies.length, detachReplies));

  return {
    chips,
    sideChatReplies,
    /** The canvas whose design-system choice this prompt runs under, or null off a canvas. */
    canvasKey,
    /** The fields a queued prompt keeps them in. */
    queued,
    /** The turn context this prompt is pinned to, with the canvas images it imported. */
    canvasContext: (imageAssetIds: readonly string[]) =>
      canvasContextOf(
        framePins,
        canvasKey === null ? null : { designSystem: chosenKit, imageAssetIds },
        elementPins,
      ),
    /** The text the agent receives: the user's words, then what goes with them. */
    compose: (prompt: string) =>
      promptWithCanvasPins(
        promptWithSideChatReplies(prompt, sideChatReplies),
        framePins,
        elementPins,
        components,
      ),
    /** The fields the sent prompt's bubble shows them from. */
    transcript: promptChips(queued),
    /** Takes them off the draft once its prompt has gone. */
    detach: () => {
      detachReplies();
      unpin(framePins);
      unpinPicked(elementPins);
      untag(components);
    },
    /** Backspace on an empty draft takes the last chip off; false when there was none. */
    removeLast: (): boolean => {
      const lastComponent = components.at(-1);
      const lastElement = elementPins.at(-1);
      const lastFrame = framePins.at(-1);
      if (lastComponent) untag([lastComponent]);
      else if (lastElement) unpinPicked([lastElement]);
      else if (lastFrame) unpin([lastFrame]);
      else if (sideChatReplies.length > 0) detachReplies();
      else return false;
      return true;
    },
    restore: (prompt: QueuedPrompt) => {
      if (!appSessionId) return;
      for (const reply of prompt.sideChatReplies ?? [])
        dispatch({ type: 'ATTACH_SIDE_CHAT_REPLY', sourceAppSessionId: appSessionId, reply });
      if (prompt.framePins) restoreFramePins(appSessionId, prompt.framePins);
      if (prompt.elementPins) restoreElementPins(appSessionId, prompt.elementPins);
      if (prompt.componentPins) restoreComponentPins(appSessionId, prompt.componentPins);
    },
  };
}
