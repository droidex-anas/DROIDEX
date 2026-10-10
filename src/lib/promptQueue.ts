import type { FramePin } from '../features/canvas/framePins';
import type {
  BrowserTranscriptReference,
  DesignReference,
  ProviderMention,
  TranscriptEvent,
} from '../types/bridge';

interface QueuedDesignContext {
  browserKey: string;
  references: DesignReference[];
  referenceIds: string[];
}

export interface QueuedPrompt {
  id: string;
  text: string;
  skills: string[];
  files: string[];
  /** Catalog rows the harness receives beside the text rather than inside it. */
  mentions?: ProviderMention[];
  /** The staged rows' catalog identities, so editing restores the same chips. */
  rowKeys?: string[];
  sideChatReplies?: string[];
  /** Canvas frames pinned to this request, as they were when it was queued. */
  framePins?: readonly FramePin[];
  design?: QueuedDesignContext;
}

export const newQueueId = () => `q-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`;

export interface PromptQueueDeliveryGuard {
  run: (deliver: () => Promise<void>) => Promise<void>;
}

export function createPromptQueueDeliveryGuard(): PromptQueueDeliveryGuard {
  let activeDelivery: Promise<void> | null = null;
  let nextDelivery: (() => Promise<void>) | null = null;
  return {
    run(deliver) {
      nextDelivery = deliver;
      if (activeDelivery) return activeDelivery;
      activeDelivery = (async () => {
        let lastFailure: Error | undefined;
        while (nextDelivery) {
          const currentDelivery = nextDelivery;
          nextDelivery = null;
          try {
            await currentDelivery();
            lastFailure = undefined;
          } catch (error) {
            lastFailure = error instanceof Error ? error : new Error(String(error));
          }
        }
        if (lastFailure !== undefined) throw lastFailure;
      })().finally(() => {
        activeDelivery = null;
      });
      return activeDelivery;
    },
  };
}

export function createLocalDesignTranscriptEvent(
  appSessionId: string,
  text: string,
  browserRefs: BrowserTranscriptReference[],
): TranscriptEvent {
  return {
    id: `local-design-${String(Date.now())}`,
    appSessionId,
    sourceSessionId: 'user',
    role: 'primary',
    ts: Date.now(),
    kind: 'text',
    text,
    author: 'user',
    browserRefs: browserRefs.length ? browserRefs : undefined,
  };
}
