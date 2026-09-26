// Voice conversations on top-level sessions: the renderer's commands in, the
// provider's handshake and transcript out. Audio never passes through here —
// the renderer negotiates WebRTC with the provider's own service, and a spoken
// request becomes an ordinary turn on the chat's model.
import { randomUUID } from 'node:crypto';
import type { ClientCommand, ServerEvent, TranscriptEvent } from '../protocol.js';
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
  appendTranscript: (event: TranscriptEvent) => void;
  // Brings a chat whose runtime was released back up, so it can be talked to.
  ensureRunning: (appSessionId: string) => Promise<void>;
  // A conversation started or ended, which changes whether its chat counts as
  // idle. Commands say so themselves; this is for the provider's own hang-ups.
  liveChanged: () => void;
}

// The provider session a subscription speaks for, so a session swapped under
// the same app session id (compaction, resume) resubscribes instead of
// forwarding a dead session's events.
interface VoiceSubscription {
  session: ProviderSession;
  unsubscribe: () => void;
}

type SpokenRole = 'user' | 'assistant';

interface SpokenLine {
  id: string;
  role: SpokenRole;
  text: string;
}

interface VoiceConversation {
  open: Map<SpokenRole, string>;
  // Per speaker: the other one can finish a line in between, and an expansion
  // still belongs to the row its own speaker last wrote.
  lastFinal: Map<SpokenRole, SpokenLine>;
}

// Long enough for a healthy round trip, short enough that closing a chat
// never feels stuck on it.
const STOP_DEADLINE_MS = 3_000;

function withDeadline(work: Promise<void> | undefined, ms: number): Promise<void> {
  if (!work) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Codex did not answer the request to end the conversation.'));
    }, ms);
    timer.unref();
    work.then(resolve, reject).finally(() => {
      clearTimeout(timer);
    });
  });
}

export class SessionVoice {
  private readonly subscriptions = new Map<string, VoiceSubscription>();
  private readonly conversations = new Map<string, VoiceConversation>();
  // The chats a conversation is wanted on. A start that is still opening reads
  // this after every await, so a hang-up in between is honoured.
  private readonly wanted = new Set<string>();

  constructor(private readonly d: SessionVoiceDependencies) {}

  async handle(cmd: VoiceCommand): Promise<void> {
    if (cmd.type === 'voice.start') this.wanted.add(cmd.appSessionId);
    if (cmd.type === 'voice.stop') this.wanted.delete(cmd.appSessionId);
    try {
      if (cmd.type === 'voice.start') {
        // The chat has to be running before it can be talked to, and idle
        // retirement may have released it. Resuming takes long enough for the
        // user to change their mind, so what they want now is what decides.
        await this.d.ensureRunning(cmd.appSessionId);
        if (!this.wanted.has(cmd.appSessionId)) return;
      }
      const voice = this.voiceFor(cmd.appSessionId);
      switch (cmd.type) {
        case 'voice.start':
          this.conversations.set(cmd.appSessionId, { open: new Map(), lastFinal: new Map() });
          await voice.start({
            sdp: cmd.sdp,
            attempt: cmd.attempt,
            voice: cmd.voice,
            narration: cmd.narration,
          });
          // Hung up while it was opening: the conversation exists now, so it
          // is closed rather than left with nobody holding it.
          if (!this.wanted.has(cmd.appSessionId)) await voice.stop();
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
      if (cmd.type === 'voice.start') throw error;
    }
  }

  // True while a conversation is running on this chat, so the rest of the
  // sidecar can tell a chat that is being talked to from an idle one.
  isLive(appSessionId: string): boolean {
    return this.d.liveSession(appSessionId)?.voice?.isLive() ?? false;
  }

  // Ends the conversation a closing session is holding. Runs before the
  // provider session is torn down, because stopping goes through it. Never
  // throws: the session closes either way.
  async closeSession(appSessionId: string): Promise<void> {
    const subscription = this.subscriptions.get(appSessionId);
    if (!subscription) return;
    this.subscriptions.delete(appSessionId);
    this.conversations.delete(appSessionId);
    this.wanted.delete(appSessionId);
    subscription.unsubscribe();
    const wasLive = subscription.session.voice?.isLive() ?? false;
    try {
      // Bounded: everything after this frees the runtime, and a stop Codex
      // never answers would otherwise hold the whole close open.
      await withDeadline(subscription.session.voice?.stop(), STOP_DEADLINE_MS);
    } catch (error) {
      console.warn(`Voice session cleanup failed: ${errMsg(error)}`);
    }
    // The subscription is gone, so the provider's own close cannot be
    // forwarded. Saying so here is what releases the renderer's microphone.
    if (wasLive) this.d.emit({ type: 'voice.state', appSessionId, status: 'closed' });
  }

  // Resolves the session's voice port and subscribes this app session to it
  // once. A session without one gets an error saying why instead.
  private voiceFor(appSessionId: string): ProviderVoice {
    const session = this.d.liveSession(appSessionId);
    if (!session) throw new Error('This chat is not running, so it cannot hold a voice session.');
    if (!session.voice) throw new Error('Voice is available on Codex chats only.');
    const existing = this.subscriptions.get(appSessionId);
    if (existing?.session !== session) {
      existing?.unsubscribe();
      this.conversations.delete(appSessionId);
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
        this.d.emit({ type: 'voice.answer', appSessionId, sdp: event.sdp, attempt: event.attempt });
        return;
      case 'started':
        this.d.emit({ type: 'voice.state', appSessionId, status: 'live' });
        this.d.liveChanged();
        return;
      case 'closed':
        this.d.emit({ type: 'voice.state', appSessionId, status: 'closed' });
        this.d.liveChanged();
        return;
      case 'transcript':
        this.d.emit({
          type: 'voice.transcript',
          appSessionId,
          role: event.role,
          text: event.text,
          final: event.final,
        });
        if (event.final) this.finishLine(appSessionId, event.role, event.text);
        else this.extendLine(appSessionId, event.role, event.text);
        return;
      case 'error':
        this.emitError(appSessionId, event.message);
        return;
    }
  }

  private extendLine(appSessionId: string, role: SpokenRole, text: string): void {
    if (!text) return;
    const conversation = this.conversationFor(appSessionId);
    conversation.open.set(role, (conversation.open.get(role) ?? '') + text);
  }

  private finishLine(appSessionId: string, role: SpokenRole, text: string): void {
    const conversation = this.conversationFor(appSessionId);
    const open = conversation.open.get(role);
    conversation.open.delete(role);
    const finalText = text || open;
    if (!finalText) return;

    let line: SpokenLine;
    const previous = conversation.lastFinal.get(role);
    if (open === undefined && previous) {
      if (finalText === previous.text) return;
      line = finalText.startsWith(previous.text)
        ? { ...previous, text: finalText }
        : { id: `voice-${randomUUID()}`, role, text: finalText };
    } else {
      line = { id: `voice-${randomUUID()}`, role, text: finalText };
    }
    this.d.appendTranscript({
      id: line.id,
      appSessionId,
      sourceSessionId: role === 'user' ? 'user' : 'primary',
      role: 'primary',
      ts: Date.now(),
      kind: 'text',
      text: line.text,
      ...(role === 'user' ? { author: 'user' as const } : {}),
      spoken: true,
    });
    conversation.lastFinal.set(role, line);
  }

  // What is being said, per chat. `voice.start` replaces it so a new
  // conversation begins with nothing open and no previous final to extend;
  // a transcript that arrives without one is still written rather than lost.
  private conversationFor(appSessionId: string): VoiceConversation {
    const existing = this.conversations.get(appSessionId);
    if (existing) return existing;
    const created: VoiceConversation = { open: new Map(), lastFinal: new Map() };
    this.conversations.set(appSessionId, created);
    return created;
  }

  private emitError(appSessionId: string, message: string): void {
    this.d.emit({ type: 'voice.error', appSessionId, message });
  }
}
