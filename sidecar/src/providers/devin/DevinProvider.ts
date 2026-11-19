import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import type { SessionConfigOption } from '@agentclientprotocol/sdk';
import { childEnv } from '../../childEnv.js';
import type { ModelInfo, ProviderStatus } from '../../protocol.js';
import type {
  ProbedProvider,
  ProviderOpenInput,
  ProviderResumeInput,
  UsageReading,
} from '../session.js';
import { resolveDevinPath } from './devinExecutable.js';
import { DevinSession } from './devinSession.js';

const exec = promisify(execFile);
const INSTALL_HINT = 'Install Devin CLI from https://cli.devin.ai, then run devin auth login.';

export class DevinProvider implements ProbedProvider {
  readonly kind = 'devin';

  async create(input: ProviderOpenInput): Promise<DevinSession> {
    const session = new DevinSession(this.executable(), input);
    await session.open();
    return session;
  }

  async resume(providerSessionId: string, input: ProviderResumeInput): Promise<DevinSession> {
    const session = new DevinSession(this.executable(), input);
    await session.open(providerSessionId);
    return session;
  }

  fork(): Promise<never> {
    return Promise.reject(new Error('Devin conversations cannot be copied.'));
  }

  readUsage(): Promise<UsageReading> {
    return Promise.resolve({ meters: [], unavailable: 'no_plan_limits' });
  }

  async probe(signal: AbortSignal): Promise<ProviderStatus> {
    const executable = resolveDevinPath();
    if (!executable) return unavailable('missing', INSTALL_HINT);
    const abort = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    let session: DevinSession | undefined;
    let version: string | undefined;
    let status: ProviderStatus;
    try {
      const options = { env: childEnv(), signal: abort, timeout: 15_000 };
      const reported = await exec(executable, ['--version'], options);
      version = /devin\s+(\S+)/i.exec(reported.stdout)?.[1];
      let auth: string;
      try {
        const result = await exec(executable, ['auth', 'status'], options);
        auth = result.stdout + result.stderr;
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'stdout' in error &&
          typeof error.stdout === 'string' &&
          /not logged in/i.test(error.stdout)
        )
          return unavailable('unauthenticated', 'Run devin auth login to sign in.', version);
        throw error;
      }
      if (/not logged in/i.test(auth))
        return unavailable('unauthenticated', 'Run devin auth login to sign in.', version);
      abort.throwIfAborted();
      session = new DevinSession(executable, {
        cwd: homedir(),
        autonomy: 'off',
        interactionMode: 'auto',
        mcpServers: [],
        interactions: {
          isActive: () => false,
          cancelPending: () => undefined,
          requestApproval: () => Promise.resolve('cancel'),
          requestQuestion: () => Promise.resolve({ cancelled: true, answers: [] }),
        },
      });
      await session.open(undefined, abort);
      abort.throwIfAborted();
      const model = session.configOptions.find((option) => option.id === 'model');
      const models = configModels(model);
      await session.delete();
      status = {
        provider: 'devin',
        readiness: 'ready',
        version,
        models,
        ...(model?.type === 'select' ? { defaultModelId: model.currentValue } : {}),
      };
    } catch (error) {
      status = unavailable(
        'error',
        error instanceof Error ? error.message : String(error),
        version,
      );
    } finally {
      try {
        await session?.close();
      } catch (error) {
        status = unavailable(
          'error',
          error instanceof Error ? error.message : String(error),
          version,
        );
      }
    }
    return status;
  }

  private executable(): string {
    const executable = resolveDevinPath();
    if (!executable) throw new Error(INSTALL_HINT);
    return executable;
  }
}

function configModels(model: SessionConfigOption | undefined): ModelInfo[] {
  if (model?.type !== 'select') return [];
  return model.options
    .flatMap((option) => ('group' in option ? option.options : [option]))
    .map((option) => ({
      id: option.value,
      displayName: option.name,
      isCustom: false,
      isDefault: option.value === model.currentValue,
    }));
}

function unavailable(
  readiness: ProviderStatus['readiness'],
  message: string,
  version?: string,
): ProviderStatus {
  return { provider: 'devin', readiness, message, models: [], ...(version ? { version } : {}) };
}
