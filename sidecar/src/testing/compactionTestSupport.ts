import { ReasoningEffort } from '@factory/droid-sdk';

import type { FactoryRuntime, FactorySession } from '../DroidRuntime.js';
import { DroidProviderSession } from '../providers/droid/DroidProviderSession.js';
import type { LiveSession } from '../SessionLifecycle.js';

export function createCompactionTestLiveSession(
  appSessionId: string,
  session: FactorySession,
  runtime: Pick<FactoryRuntime, 'processIdOf' | 'isProcessAlive'>,
): LiveSession {
  return {
    summary: {
      appSessionId,
      providerSessionId: session.sessionId,
      provider: 'droid',
      sessionPurpose: 'chat',
      interactionMode: 'auto',
      role: 'user',
      title: appSessionId,
      goal: 'test',
      cwd: '/workspace',
      workspaceKind: 'folder',
      modelId: 'model-default',
      reasoningEffort: ReasoningEffort.Low,
      autonomy: 'low',
      phase: 'paused',
      features: [],
      tokensIn: 0,
      tokensOut: 0,
      contextTokens: 0,
      maxContextTokens: 1_000,
      createdAt: 1,
      updatedAt: 1,
    },
    session: new DroidProviderSession(appSessionId, session, runtime),
    droid: session,
    streaming: false,
    autoCompacting: false,
    pendingSends: [],
    mcpServers: [],
    mcpConfigs: [],
  };
}
