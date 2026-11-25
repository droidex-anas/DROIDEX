import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { childEnv } from '../../childEnv.js';
import type { ProviderStatus } from '../../protocol.js';
import type {
  ProviderForkSource,
  ProviderForkHandle,
  ProbedProvider,
  ProviderOpenInput,
  ProviderResumeInput,
  UsageReading,
} from '../session.js';
import { resolveDevinPath } from './devinExecutable.js';
import { DevinSession } from './devinSession.js';
import { DevinClient } from './devinClient.js';
import { DevinTerminals } from './devinTerminals.js';
import { readDevinApiKey } from './devinCredentials.js';
import { saveDevinForkSeed } from './devinForkSeed.js';
import {
  configModels,
  parseDevinModelListing,
  selectValues,
  thoughtMetadata,
  type DevinModelCatalog,
  type DevinThoughtMetadata,
} from './devinModels.js';

const exec = promisify(execFile);
const INSTALL_HINT = 'Install Devin CLI from https://cli.devin.ai, then run devin auth login.';

interface DevinCommandOptions {
  env: Record<string, string>;
  signal: AbortSignal;
  timeout: number;
}

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

  async fork(source: ProviderForkSource): Promise<ProviderForkHandle> {
    const cwd = source.cwd ?? homedir();
    const terminals = new DevinTerminals(
      cwd,
      () => false,
      () => undefined,
    );
    const client = new DevinClient(this.executable(), cwd, {
      terminals,
      update: () => undefined,
      permission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
    });
    try {
      const signal = AbortSignal.timeout(30_000);
      const initialized = await client.initialize(signal);
      // Transcript turn points are not ACP cursors; never send them as native cursor IDs.
      const native =
        initialized.agentCapabilities?.sessionCapabilities?.fork != null && !source.forkPointId;
      if (!native && !source.transcriptSeed?.trim())
        throw new Error('Cannot fork Devin: the app-owned transcript is unavailable or empty.');
      if (
        !native &&
        initialized.agentCapabilities?._meta?.['cognition.ai/persistOnCreate'] !== true
      )
        throw new Error('This Devin CLI cannot persist an idle copy. Update Devin and try again.');
      const options = { cancellationSignal: signal, stopWaitingOnCancel: true };
      await client.authenticate(initialized.authMethods, signal);
      const copy = native
        ? await client.connection.agent.request(
            'session/fork',
            {
              sessionId: source.providerSessionId,
              cwd,
              mcpServers: [],
            },
            options,
          )
        : await client.connection.agent.request(
            'session/new',
            {
              cwd,
              mcpServers: [],
              _meta: { 'cognition.ai/persistOnCreate': true },
            },
            options,
          );
      if (!native && source.transcriptSeed !== undefined)
        await saveDevinForkSeed(copy.sessionId, source.transcriptSeed);
      return { providerSessionId: copy.sessionId };
    } finally {
      try {
        await client.stop();
      } finally {
        await terminals.close();
      }
    }
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
      const options: DevinCommandOptions = { env: childEnv(), signal: abort, timeout: 15_000 };
      const reported = await exec(executable, ['--version'], options);
      version = /devin\s+(\S+)/i.exec(reported.stdout)?.[1];
      if (!(await readDevinApiKey()))
        return unavailable('unauthenticated', 'Run devin auth login to sign in.', version);
      abort.throwIfAborted();
      const listedCatalog = readDevinModelCatalog(executable, options);
      session = probeSession(executable);
      await session.open(undefined, abort);
      abort.throwIfAborted();
      const model = session.configOptions.find((option) => option.id === 'model');
      const thought = session.configOptions.find((option) => option.id === 'thought_level');
      const [catalog, scanned] = await Promise.all([
        listedCatalog,
        scanThoughtMetadata(executable, session, model, abort),
      ]);
      abort.throwIfAborted();
      const models = configModels(model, thought, catalog, scanned);
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

async function readDevinModelCatalog(
  executable: string,
  options: DevinCommandOptions,
): Promise<DevinModelCatalog | undefined> {
  try {
    const listed = await exec(executable, ['models', 'list', '--format', 'json'], options);
    return parseDevinModelListing(listed.stdout);
  } catch {
    // Cost and context metadata enrich the picker; an older or signed-out CLI
    // still has a usable ACP catalog without it.
    return undefined;
  }
}

function probeSession(executable: string): DevinSession {
  return new DevinSession(executable, {
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
}

// Choosing each base model once is the only authoritative way ACP reveals that
// model's own thought levels. Four short-lived scratch sessions keep the scan
// inside the probe's budget; no prompt is sent.
async function scanThoughtMetadata(
  executable: string,
  firstSession: DevinSession,
  model: DevinSession['configOptions'][number] | undefined,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, DevinThoughtMetadata>> {
  const scanned = new Map<string, DevinThoughtMetadata>();
  const modelIds = selectValues(model).filter((modelId) => !modelId.startsWith('fusion-'));
  if (modelIds.length === 0) return scanned;
  const workerCount = Math.min(4, modelIds.length);
  const chunks = Array.from({ length: workerCount }, (): string[] => []);
  modelIds.forEach((modelId, index) => chunks[index % workerCount]?.push(modelId));
  const workers = chunks.map(async (modelIdsChunk, index) => {
    const session = index === 0 ? firstSession : probeSession(executable);
    const ownsSession = index !== 0;
    try {
      if (ownsSession) await session.open(undefined, signal);
      for (const modelId of modelIdsChunk) {
        signal.throwIfAborted();
        try {
          await session.setModel({ modelId });
          scanned.set(
            modelId,
            thoughtMetadata(session.configOptions.find((option) => option.id === 'thought_level')),
          );
        } catch {
          // A row that refuses selection still remains selectable through ACP;
          // it simply lacks reasoning metadata in the picker.
        }
      }
    } catch {
      // Thought metadata is optional enrichment. A worker failure must not turn
      // an otherwise authenticated provider probe into an error.
    } finally {
      if (ownsSession) {
        await session.delete().catch(() => undefined);
        await session.close().catch(() => undefined);
      }
    }
  });
  await Promise.all(workers);
  return scanned;
}

function unavailable(
  readiness: ProviderStatus['readiness'],
  message: string,
  version?: string,
): ProviderStatus {
  return { provider: 'devin', readiness, message, models: [], ...(version ? { version } : {}) };
}
