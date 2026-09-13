import type { McpServerConfig } from '@factory/droid-sdk';

import type { CreateRuntimeSessionOptions } from '../DroidRuntime.js';
import type { NormalizedEvent } from '../normalize.js';
import type { Autonomy, ReasoningEffort } from '../protocol.js';
import type { ProviderInteractions } from './interactions.js';
import type { ProviderKind } from './providerKind.js';

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
  autonomy?: Autonomy;
  interactions: ProviderInteractions;
}

export interface ProviderModelSettings {
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface ProviderSession {
  readonly provider: ProviderKind;
  // Native id of the session the provider holds open.
  readonly providerSessionId: string;
  // The live agent process, when the provider runs one, so it can be tracked.
  readonly process?: { pid: number; isAlive(): boolean };
  // Returning means the turn settled; throwing means it failed. There is no
  // settlement event.
  stream(prompt: string): AsyncGenerator<NormalizedEvent, void, undefined>;
  // The two things a live session can still change. Everything else about a
  // session is fixed when it opens.
  setAutonomy(autonomy: Autonomy): Promise<void>;
  setModel(settings: ProviderModelSettings): Promise<void>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export interface Provider {
  readonly kind: ProviderKind;
  create(input: ProviderOpenInput): Promise<ProviderSession>;
  resume(providerSessionId: string, input: ProviderResumeInput): Promise<ProviderSession>;
}
