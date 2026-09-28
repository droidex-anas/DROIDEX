import type { McpServerConfig } from '@factory/droid-sdk';

import type { CreateRuntimeSessionOptions } from '../DroidRuntime.js';
import type { NormalizedEvent } from '../normalize.js';
import type {
  Autonomy,
  ReasoningEffort,
  SessionInteractionMode,
  VoiceNarration,
} from '../protocol.js';
import type { ProviderMention, SkillInfo } from './catalog.js';
import type { ProviderInteractions } from './interactions.js';
import type { ProviderKind } from './providerKind.js';
import type { ProviderProbe } from './providerProbes.js';

// The option shape the lifecycle already builds. A provider ignores the fields
// its runtime does not support; Droid's handler pair is replaced by the neutral
// interactions port.
export type ProviderOpenInput = Omit<
  CreateRuntimeSessionOptions,
  'permissionHandler' | 'askUserHandler'
> & { interactions: ProviderInteractions };

export interface ProviderResumeInput {
  // DROIDEX's own identity for the session, which a resumed provider session
  // does not carry and which stamps everything the session streams.
  appSessionId: string;
  // The provider's own resume handle when it differs from providerSessionId
  // (a Codex thread id); absent for providers that resume by session id.
  resumeId?: string;
  cwd?: string;
  mcpServers?: McpServerConfig[];
  // The stored launch settings, for a provider that keeps no session file of
  // its own and therefore cannot read them back. Droid reads its own.
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  autonomy?: Autonomy;
  interactionMode?: SessionInteractionMode;
  interactions: ProviderInteractions;
}

export interface ProviderModelSettings {
  // A string selects that model; null resets the session to the provider's own
  // default; absent leaves the model alone.
  modelId?: string | null;
  // A level selects it; null clears the level a previous model carried, for a
  // model that offers none; absent leaves it alone.
  reasoningEffort?: ReasoningEffort | null;
}

// A live voice conversation on the same session: the client negotiates WebRTC
// with the provider's own service, so audio never reaches the sidecar. The
// session relays the handshake and reports what was said.
export type { VoiceNarration };

export interface ProviderVoiceStart {
  // The client's SDP offer, built from its microphone and audio sink.
  sdp: string;
  /** Names this negotiation, so its answer is not taken by the next one. */
  attempt: string;
  // One of the voices `listVoices` published; absent takes the provider default.
  voice?: string;
  // How much the agent's work is spoken while it runs.
  narration?: VoiceNarration;
}

export type ProviderVoiceEvent =
  | { kind: 'answer'; sdp: string; attempt: string }
  | { kind: 'started' }
  | { kind: 'transcript'; role: 'user' | 'assistant'; text: string; final: boolean }
  | { kind: 'closed' }
  | { kind: 'error'; message: string };

export interface ProviderVoice {
  /** True from the moment a conversation is asked for until it is stopped. */
  isLive(): boolean;
  // The voices this provider offers, and the one it uses when none is chosen.
  listVoices(): Promise<{ voices: string[]; defaultVoice?: string }>;
  start(input: ProviderVoiceStart): Promise<void>;
  stop(): Promise<void>;
  onEvent(listener: (event: ProviderVoiceEvent) => void): () => void;
}

export interface ProviderSession {
  readonly provider: ProviderKind;
  // Native id of the session the provider holds open.
  readonly providerSessionId: string;
  // The provider's own handle for reopening this conversation, when it differs
  // from providerSessionId. Only Codex, which mints its own thread ids, has one.
  readonly resumeId?: string;
  // The live agent process, when the provider runs one, so it can be tracked.
  readonly process?: { pid: number; isAlive(): boolean };
  // For a runtime that can end outside a turn. Never rejects; a failure carries
  // its diagnostic, and intentional closure resolves without one.
  readonly closed?: Promise<Error | undefined>;
  // Synchronous counterpart for queue advancement before closure observers run.
  readonly isClosed?: boolean;
  // Returning means the turn settled; throwing means it failed. There is no
  // settlement event.
  stream(
    prompt: string,
    mentions?: ProviderMention[],
  ): AsyncGenerator<NormalizedEvent, void, undefined>;
  // Events delivered between turns, never duplicated by stream().
  onBackgroundEvent?(listener: (event: NormalizedEvent) => void): () => void;

  /**
   * A turn the provider started by itself, outside `stream()`, and the moment
   * it ends. A spoken request is one: the chat is running a turn nobody asked
   * for through the composer, and the rest of the app has to know so a typed
   * prompt queues behind it and Stop can reach it.
   */
  onDelegatedTurn?(listener: (running: boolean) => void): () => void;
  // Takes a prompt into the turn that is already running, so the turn keeps its
  // work and continues with it. Absent on a provider that can only steer by
  // interrupting and resending, which is what the session layer then does.
  steer?(text: string, mentions?: ProviderMention[]): Promise<void>;
  // Provider-native command/skill/app/plugin rows, cached for this live runtime.
  catalogItems?(): Promise<SkillInfo[]>;
  onCatalogUpdated?(listener: (items: SkillInfo[]) => void): () => void;
  // The two things a live session can still change. Everything else about a
  // session is fixed when it opens.
  setAutonomy(autonomy: Autonomy): Promise<void>;
  setModel(settings: ProviderModelSettings): Promise<void>;
  // Only for a provider that has a planning mode of its own. Absent means the
  // session runs in Auto always, and the composer offers no Spec toggle for it.
  setInteractionMode?(mode: SessionInteractionMode): Promise<void>;
  // Present only on a provider that can hold a voice conversation.
  readonly voice?: ProviderVoice;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface Provider {
  readonly kind: ProviderKind;
  create(input: ProviderOpenInput): Promise<ProviderSession>;
  resume(providerSessionId: string, input: ProviderResumeInput): Promise<ProviderSession>;
}

// A provider backed by a CLI learns what it can do by probing that CLI; Droid's
// runtime reports its own status instead.
export interface ProbedProvider extends Provider {
  probe: ProviderProbe;
}
