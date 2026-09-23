// Voice conversations on top-level sessions: the renderer's commands in, the
// provider's handshake and transcript out. Audio never passes through here —
// the renderer negotiates WebRTC with the provider's own service, and a spoken
// request becomes an ordinary turn on the chat's model.
import type { ClientCommand, ServerEvent } from '../protocol.js';
import { errMsg } from '../sessionHelpers.js';
import type { ProviderSession, ProviderVoice, ProviderVoiceEvent } from './session.js';

export type VoiceCommand = Extract<
  ClientCommand,
  { type: 'voice.start' | 'voice.stop' | 'voice.voices' }
>;

export interface SessionVoiceDependencies {
  // The live session for an app session id, or undefined when none is running.
  liveSession: (appSessionId: string) => ProviderSession | undefined;
  emit: (event: ServerEvent) => void;
}

// The provider session a subscription speaks for, so a session swapped under
// the same app session id (compaction, resume) resubscribes instead of
// forwarding a dead session's events.
interface VoiceSubscription {
  session: ProviderSession;
  unsubscribe: () => void;
}

export class SessionVoice {
  private readonly subscriptions = new Map<string, VoiceSubscription>();

  constructor(private readonly d: SessionVoiceDependencies) {}

  async handle(cmd: VoiceCommand): Promise<void> {
    const voice = this.voiceFor(cmd.appSessionId);
    if (!voice) return;
    try {
      switch (cmd.type) {
        case 'voice.start':
          await voice.start({ sdp: cmd.sdp, voice: cmd.voice, narration: cmd.narration });
          return;
        case 'voice.stop':
          await voice.stop();
          return;
        case 'voice.voices': {
          const { voices, defaultVoice } = await voice.listVoices();
          this.d.emit({
            type: 'voice.voices',
            appSessionId: cmd.appSessionId,
            voices,
            defaultVoice,
          });
          return;
        }
      }
    } catch (error) {
      this.emitError(cmd.appSessionId, errMsg(error));
    }
  }

  // Ends the conversation a closing session is holding. Runs before the
  // provider session is torn down, because stopping goes through it. Never
  // throws: the session closes either way.
  async closeSession(appSessionId: string): Promise<void> {
    const subscription = this.subscriptions.get(appSessionId);
    if (!subscription) return;
    this.subscriptions.delete(appSessionId);
    subscription.unsubscribe();
    try {
      await subscription.session.voice?.stop();
    } catch (error) {
      console.warn(`Voice session cleanup failed: ${errMsg(error)}`);
    }
  }

  // Resolves the session's voice port and subscribes this app session to it
  // once. A session without one gets the reason instead.
  private voiceFor(appSessionId: string): ProviderVoice | undefined {
    const session = this.d.liveSession(appSessionId);
    if (!session) {
      this.emitError(appSessionId, 'This chat is not running, so it cannot hold a voice session.');
      return undefined;
    }
    if (!session.voice) {
      this.emitError(appSessionId, 'Voice is available on Codex chats only.');
      return undefined;
    }
    const existing = this.subscriptions.get(appSessionId);
    if (existing?.session !== session) {
      existing?.unsubscribe();
      this.subscriptions.set(appSessionId, {
        session,
        unsubscribe: session.voice.onEvent((event) => {
          this.forward(appSessionId, event);
        }),
      });
    }
    return session.voice;
  }

  private forward(appSessionId: string, event: ProviderVoiceEvent): void {
    switch (event.kind) {
      case 'answer':
        this.d.emit({ type: 'voice.answer', appSessionId, sdp: event.sdp });
        return;
      case 'started':
        this.d.emit({ type: 'voice.state', appSessionId, status: 'live' });
        return;
      case 'closed':
        this.d.emit({ type: 'voice.state', appSessionId, status: 'closed', reason: event.reason });
        return;
      case 'transcript':
        this.d.emit({
          type: 'voice.transcript',
          appSessionId,
          role: event.role,
          text: event.text,
          final: event.final,
        });
        return;
      case 'error':
        this.emitError(appSessionId, event.message);
        return;
    }
  }

  private emitError(appSessionId: string, message: string): void {
    this.d.emit({ type: 'voice.error', appSessionId, message });
  }
}
