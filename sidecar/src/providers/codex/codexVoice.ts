// Codex's realtime voice on a thread. The client builds the WebRTC offer from
// its microphone and speaker, Codex answers with an SDP of its own, and from
// then on audio flows between the client and OpenAI directly. What passes
// through here is the handshake, the transcript, and the end of the session.
//
// A spoken request becomes an ordinary turn on the same thread, run by the
// model the chat already uses, so tools, approvals and diffs behave as they do
// for a typed prompt.
import type {
  ProviderVoice,
  ProviderVoiceEvent,
  ProviderVoiceStart,
  VoiceNarration,
} from '../session.js';
import type { AppServerClient } from './appServer.js';

// Realtime v3 is the version that supports voices, spoken handoffs and the
// narration modes; v1 and v2 ignore the handoff setting.
const VERSION = 'v3';

// What the voice is told when a conversation opens. It knows the thread it
// sits on, but nothing about the app it is speaking inside, so this says where
// it is, who does the work, and how to sound. It claims nothing the app cannot
// do: the agent is the chat's own model, and approvals still belong to the user.
const START_INSTRUCTIONS = [
  'You are the voice of DROIDEX, a desktop app the user runs coding agents in.',
  'You are speaking about the chat that is open in front of them, in its working directory.',
  'Answer short questions yourself, briefly. Anything that touches the project, such as',
  'reading, running, editing or searching, goes to the agent on this thread, which is the',
  'model the user chose for this chat. Say in a few words what you are handing over.',
  'Speak the way a colleague would: short sentences, no lists read aloud, no code read out',
  'character by character, file names spoken plainly. Summarise what the agent did rather',
  'than reciting it; the user can see the chat.',
  'Never claim something ran, changed or finished unless the agent reported it.',
].join(' ');

const HANDOFF_MODE: Record<VoiceNarration, string> = {
  brief: 'thinking',
  commentary: 'commentary',
};

interface VoicesResponse {
  voices: Record<string, string[] | undefined>;
  defaultV1?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textOf(params: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

function roleOf(params: Record<string, unknown>): 'user' | 'assistant' {
  return params.role === 'assistant' ? 'assistant' : 'user';
}

export class CodexVoice implements ProviderVoice {
  private readonly listeners = new Set<(event: ProviderVoiceEvent) => void>();
  // True from the moment a conversation is asked for, not from the moment it
  // connects: a hang-up during the handshake still has to reach Codex.
  private live = false;
  // Each stop produces a `closed` of its own. The app already knows, so those
  // are counted off instead of published: the next conversation on this thread
  // must not be closed by the last one's acknowledgement, however late it
  // arrives.
  private expectedCloses = 0;

  // `threadId` is read at call time: the thread opens after the session is
  // constructed, and a resume replaces it.
  constructor(
    private readonly client: AppServerClient,
    private readonly threadId: () => string | undefined,
  ) {
    this.client.onNotification('thread/realtime/sdp', (params) => {
      if (isRecord(params) && typeof params.sdp === 'string')
        this.publish({ kind: 'answer', sdp: params.sdp });
    });
    this.client.onNotification('thread/realtime/started', () => {
      // A `started` that lands after the hang-up belongs to a conversation
      // nobody is holding any more.
      if (this.live) this.publish({ kind: 'started' });
    });
    this.client.onNotification('thread/realtime/transcript/delta', (params) => {
      if (!isRecord(params)) return;
      const text = textOf(params, 'delta', 'text');
      if (text) this.publish({ kind: 'transcript', role: roleOf(params), text, final: false });
    });
    this.client.onNotification('thread/realtime/transcript/done', (params) => {
      if (!isRecord(params)) return;
      this.publish({
        kind: 'transcript',
        role: roleOf(params),
        text: textOf(params, 'text'),
        final: true,
      });
    });
    this.client.onNotification('thread/realtime/error', (params) => {
      const message = isRecord(params) ? textOf(params, 'message') : '';
      this.publish({ kind: 'error', message: message || 'The voice session failed.' });
    });
    this.client.onNotification('thread/realtime/closed', () => {
      if (this.expectedCloses > 0) {
        this.expectedCloses -= 1;
        return;
      }
      this.live = false;
      this.publish({ kind: 'closed' });
    });
  }

  async listVoices(): Promise<{ voices: string[]; defaultVoice?: string }> {
    const response = await this.client.request<VoicesResponse>('thread/realtime/listVoices', {});
    return {
      voices: response.voices[VERSION] ?? response.voices.v1 ?? [],
      defaultVoice: response.defaultV1,
    };
  }

  isLive(): boolean {
    return this.live;
  }

  async start({ sdp, voice, narration = 'brief' }: ProviderVoiceStart): Promise<void> {
    const threadId = this.requireThread();
    this.live = true;
    await this.client
      .request('thread/realtime/start', {
        threadId,
        outputModality: 'audio',
        version: VERSION,
        transport: { type: 'webrtc', sdp },
        codexResponseHandoffMode: HANDOFF_MODE[narration],
        realtimeStartInstructions: START_INSTRUCTIONS,
        ...(voice ? { voice } : {}),
      })
      .catch((error: unknown) => {
        this.live = false;
        throw error;
      });
  }

  // Leaves the session marked live until Codex confirms, so a stop that failed
  // can be tried again instead of silently doing nothing.
  async stop(): Promise<void> {
    if (!this.live) return;
    this.expectedCloses += 1;
    try {
      await this.client.request('thread/realtime/stop', { threadId: this.requireThread() });
    } catch (error) {
      // Nothing was stopped, so no close is owed and a real one still counts.
      this.expectedCloses -= 1;
      throw error;
    }
    this.live = false;
  }

  onEvent(listener: (event: ProviderVoiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private requireThread(): string {
    const threadId = this.threadId();
    if (!threadId) throw new Error('The chat has no Codex thread yet.');
    return threadId;
  }

  private publish(event: ProviderVoiceEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
