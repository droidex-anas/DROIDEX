import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import { childEnv } from '../../childEnv.js';
import type { ModelInfo, ProviderStatus, SkillInfo } from '../../protocol.js';
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
import { readDevinForkSeed, saveDevinForkSeed } from './devinForkSeed.js';
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
  private thoughtMetadataVersion?: string;
  private readonly thoughtMetadata = new Map<string, DevinThoughtMetadata>();
  private modelCatalog?: DevinModelCatalog;
  private thoughtScan?: {
    version?: string;
    covered: readonly string[];
    signal: AbortSignal;
    promise: Promise<ReadonlyMap<string, DevinThoughtMetadata>>;
  };

  async create(input: ProviderOpenInput): Promise<DevinSession> {
    // A chat must remain resumable even if the sidecar stops before its first turn.
    const session = new DevinSession(this.executable(), input, true);
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
      // A source still holding an unsent seed has no backend history to clone.
      const native =
        initialized.agentCapabilities?.sessionCapabilities?.fork != null &&
        !source.forkPointId &&
        (await readDevinForkSeed(source.providerSessionId)) === undefined;
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

  async probe(
    signal: AbortSignal,
    publishItems?: (items: SkillInfo[]) => void,
    publishModels?: (models: ModelInfo[]) => void,
  ): Promise<ProviderStatus> {
    const executable = resolveDevinPath();
    if (!executable) return unavailable('missing', INSTALL_HINT);
    const abort = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const catalogAbortController = new AbortController();
    const catalogAbort = AbortSignal.any([
      signal,
      AbortSignal.timeout(45_000),
      catalogAbortController.signal,
    ]);
    let session: DevinSession | undefined;
    let stopCatalogUpdates: (() => void) | undefined;
    let version: string | undefined;
    let status: ProviderStatus | undefined;
    try {
      const options: DevinCommandOptions = { env: childEnv(), signal: abort, timeout: 15_000 };
      const catalogOptions: DevinCommandOptions = {
        env: childEnv(),
        signal: catalogAbort,
        timeout: 45_000,
      };
      const reported = await exec(executable, ['--version'], options);
      version = /devin\s+(\S+)/i.exec(reported.stdout)?.[1];
      if (!(await readDevinApiKey()))
        return unavailable('unauthenticated', 'Run devin auth login to sign in.', version);
      abort.throwIfAborted();
      this.retainEnrichmentVersion(version);
      const listedCatalog = readDevinModelCatalog(executable, catalogOptions).then((catalog) => {
        if (catalog && this.thoughtMetadataVersion === version) this.modelCatalog = catalog;
        return catalog;
      });
      session = probeSession(executable);
      if (publishItems)
        stopCatalogUpdates = session.onCatalogUpdated((items) => {
          if (!signal.aborted) publishItems(items);
        });
      await session.open(undefined, abort);
      abort.throwIfAborted();
      const model = session.configOptions.find((option) => option.id === 'model');
      const thought = session.configOptions.find((option) => option.id === 'thought_level');
      const scanned = this.scanThoughts(executable, model, version, signal).catch(() => undefined);
      let models: ModelInfo[];
      if (publishModels) {
        const cached = this.cachedEnrichment(version);
        let catalog = cached.catalog;
        let thoughts = cached.thoughts;
        let scanFinished = false;
        const publishEnriched = () => {
          if (!scanFinished || signal.aborted) return;
          publishModels(configModels(model, thought, catalog, thoughts));
        };
        void listedCatalog
          .then((listed) => {
            if (listed) catalog = listed;
            publishEnriched();
          })
          .catch(() => undefined);
        void scanned
          .then((metadata) => {
            if (metadata) thoughts = metadata;
            scanFinished = true;
            publishEnriched();
          })
          .catch(() => undefined);
        models = configModels(model, thought, catalog, thoughts);
      } else {
        const [catalog, metadata] = await Promise.all([listedCatalog, scanned]);
        models = configModels(
          model,
          thought,
          catalog ?? this.cachedEnrichment(version).catalog,
          metadata,
        );
      }
      await session.delete();
      abort.throwIfAborted();
      status = {
        provider: 'devin',
        readiness: 'ready',
        version,
        models,
        ...(model?.type === 'select' ? { defaultModelId: model.currentValue } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rejected =
        /authentication failed|invalid api key|authentication required|not logged in/i.test(
          message,
        );
      catalogAbortController.abort();
      status = unavailable(
        rejected ? 'unauthenticated' : 'error',
        rejected
          ? 'Devin rejected the stored credential. Run devin auth login to sign in again.'
          : message,
        version,
      );
    } finally {
      stopCatalogUpdates?.();
      try {
        await session?.close();
      } catch {
        // Cleanup of a disposable probe session must not replace the probe's answer.
      }
    }
    return status;
  }

  private retainEnrichmentVersion(version?: string): void {
    if (this.thoughtMetadataVersion === version) return;
    this.thoughtMetadataVersion = version;
    this.thoughtMetadata.clear();
    this.modelCatalog = undefined;
    this.thoughtScan = undefined;
  }

  private cachedEnrichment(version?: string): {
    thoughts: ReadonlyMap<string, DevinThoughtMetadata>;
    catalog?: DevinModelCatalog;
  } {
    this.retainEnrichmentVersion(version);
    return { thoughts: new Map(this.thoughtMetadata), catalog: this.modelCatalog };
  }

  private scanThoughts(
    executable: string,
    model: DevinSession['configOptions'][number] | undefined,
    version: string | undefined,
    probeSignal: AbortSignal,
  ): Promise<ReadonlyMap<string, DevinThoughtMetadata>> {
    const cached = this.cachedEnrichment(version).thoughts;
    const missing = selectValues(model).filter(
      (modelId) => !modelId.startsWith('fusion-') && !cached.has(modelId),
    );
    if (missing.length === 0) return Promise.resolve(cached);
    const current = this.thoughtScan;
    const existing =
      current !== undefined &&
      current.version === version &&
      !current.signal.aborted &&
      missing.every((modelId) => current.covered.includes(modelId))
        ? current.promise
        : undefined;
    const scan =
      existing ??
      (async () => {
        const scanSignal = AbortSignal.any([probeSignal, AbortSignal.timeout(45_000)]);
        const promise = scanThoughtMetadata(executable, missing, scanSignal);
        const currentScan = { version, covered: missing, signal: scanSignal, promise };
        this.thoughtScan = currentScan;
        try {
          const scanned = await promise;
          if (this.thoughtMetadataVersion === version)
            for (const [modelId, metadata] of scanned) this.thoughtMetadata.set(modelId, metadata);
          return scanned;
        } finally {
          if (this.thoughtScan === currentScan) this.thoughtScan = undefined;
        }
      })();
    return scan.then((scanned) => new Map([...cached, ...scanned]));
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
// model's own thought levels. The scan uses up to four short-lived scratch
// sessions and sends no prompt.
async function scanThoughtMetadata(
  executable: string,
  modelIds: readonly string[],
  signal: AbortSignal,
): Promise<ReadonlyMap<string, DevinThoughtMetadata>> {
  const scanned = new Map<string, DevinThoughtMetadata>();
  if (modelIds.length === 0) return scanned;
  const workerCount = Math.min(4, modelIds.length);
  const chunks = Array.from({ length: workerCount }, (): string[] => []);
  modelIds.forEach((modelId, index) => chunks[index % workerCount]?.push(modelId));
  const sessions = new Set<DevinSession>();
  const closeOnAbort = () => {
    for (const session of sessions) void session.close().catch(() => undefined);
  };
  signal.addEventListener('abort', closeOnAbort, { once: true });
  const workers = chunks.map(async (modelIdsChunk) => {
    const session = probeSession(executable);
    sessions.add(session);
    try {
      await session.open(undefined, signal);
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
      await session.delete().catch(() => undefined);
      await session.close().catch(() => undefined);
      sessions.delete(session);
    }
  });
  try {
    await Promise.all(workers);
  } finally {
    signal.removeEventListener('abort', closeOnAbort);
  }
  return scanned;
}

function unavailable(
  readiness: ProviderStatus['readiness'],
  message: string,
  version?: string,
): ProviderStatus {
  return { provider: 'devin', readiness, message, models: [], ...(version ? { version } : {}) };
}
