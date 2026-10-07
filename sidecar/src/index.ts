import { join } from 'node:path';
import { CanvasBuilds } from './canvas/CanvasBuilds.js';
import { createCanvasCommandHandler } from './canvas/canvasBridge.js';
import { CanvasScopes } from './canvas/canvasScopes.js';
import { CanvasTurns } from './canvas/canvasTurnContext.js';
import { CanvasWorkspace } from './canvas/CanvasWorkspace.js';
import { ProjectService } from './projects/ProjectService.js';
import { ProjectStore } from './projects/store.js';
import { ProjectSessions } from './projects/sessions.js';
import { createProjectCommandHandler } from './projects/bridge.js';
import { registerProjectService } from './projects/service.js';
import {
  configureAutomationManager,
  type AutomationManager,
} from './automations/AutomationManager.js';
import { SessionManager } from './SessionManager.js';
import { startBridgeServer } from './bridgeServer.js';
import { canvasDir, droidexUserDataDir } from './droidexPaths.js';
import { shutdownSidecar } from './shutdown.js';
import { hotPathMetrics } from './telemetry/hotPathMetrics.js';

const REQUESTED_PORT = bridgePort(process.env.BRIDGE_PORT ?? '0');
const TOKEN = requiredSecret('BRIDGE_TOKEN');
const ASSET_TOKEN = requiredSecret('BROWSER_ASSET_TOKEN');
const CANVAS_EXPORT_TOKEN = process.env.CANVAS_EXPORT_TOKEN;
const EXIT_ON_STDIN_CLOSE = process.env.BRIDGE_EXIT_ON_STDIN_CLOSE !== '0';

let automationManager: AutomationManager | null = null;
let projects: ProjectService | undefined;

const server = startBridgeServer({
  requestedPort: REQUESTED_PORT,
  token: TOKEN,
  assetToken: ASSET_TOKEN,
  canvasExportToken: CANVAS_EXPORT_TOKEN,
  onCommand: async (command, pageId) => {
    if (command.type === 'session.interrupt' || command.type === 'session.close') {
      // Invalidate automatic work immediately; never delay the user's Stop for disk IO.
      void projects?.userStopped(command.appSessionId).catch(reportProjectError);
    }
    if (await handleProjectCommand(command)) return;
    if (await handleCanvasCommand(command, pageId)) return;
    if (automationManager && (await automationManager.handleBridgeCommand(command))) return;
    await manager.handle(command);
  },
  getSnapshot: () => manager.runtimeSnapshot(),
});

// Canvas leases live beside the workspace that checks them: the pane registers
// one per mutation request, and each turn's lease is registered here.
const canvasScopes = new CanvasScopes();
let canvasWorkspace: CanvasWorkspace | undefined;
const canvasTurns = new CanvasTurns(
  canvasScopes,
  (appSessionId) => canvasWorkspace?.attachedCanvasId(appSessionId) ?? null,
);

const manager = new SessionManager(
  (event) => {
    projectSessions.observe(event);
    if (projects) void projects.observe(event).catch(reportProjectError);
    if (automationManager) {
      void automationManager.observeSessionEvent(event).catch((error: unknown) => {
        console.error('Automation lifecycle observer failed', error);
      });
    }
    server.broadcast(event);
  },
  {
    canvasTurns,
    canvasWorkspace: () => canvasReady,
    assetUrlFor: (filePath) => server.browserAssetUrl(filePath),
    beforeFirstTurn: async (session, clientRef) => {
      await projectSessions.beforeFirstTurn(session, clientRef);
    },
    onSessionAvailable: (appSessionId) => {
      projects?.sessionAvailable(appSessionId);
      void automationManager?.observeSessionAvailability(appSessionId).catch((error: unknown) => {
        console.error('Automation availability observer failed', error);
      });
    },
    onScheduledCapacityChanged: () => {
      projects?.capacityChanged();
      void automationManager?.observeSchedulingCapacity().catch((error: unknown) => {
        console.error('Automation scheduling capacity observer failed', error);
      });
    },
  },
);

// Declared after the manager it wraps, and reached only from its callbacks,
// which run long after this module has finished loading.
const projectSessions = new ProjectSessions(manager);
const projectsReady = ProjectService.open(
  projectSessions,
  new ProjectStore(join(droidexUserDataDir(), 'projects.json')),
  (event) => {
    server.broadcast(event);
  },
).then((service) => {
  projects = service;
  if (shuttingDown) service.close();
  return service;
});
registerProjectService(projectsReady);
void projectsReady.catch(reportProjectError);
const handleProjectCommand = createProjectCommandHandler(projectsReady, (event) => {
  server.broadcast(event);
});

function reportProjectError(error: unknown): void {
  server.broadcast({
    type: 'error',
    code: 'project.failed',
    message: error instanceof Error ? error.message : String(error),
  });
}

// Builds are projected into every frame the workspace hands out, so the
// registry exists before the workspace that reads it.
const canvasBuilds = new CanvasBuilds();
// Annotated because `isChatKnown` below reads the manager that was handed this
// promise, which leaves TypeScript nothing to infer either type from.
const canvasReady: Promise<CanvasWorkspace> = CanvasWorkspace.open(canvasDir(), canvasBuilds, {
  isScopeActive: (scopeId) => canvasScopes.isScopeActive(scopeId),
  bindScopeCanvas: (scopeId, canvasId) => {
    canvasScopes.bindScopeCanvas(scopeId, canvasId);
  },
  isChatKnown: (appSessionId) =>
    manager.sessionSummary(appSessionId)?.appSessionId === appSessionId,
}).then((workspace) => {
  if (shuttingDown) void workspace.close();
  // A turn's lease reads the chat's attachment from here; until Canvas storage
  // opens, every chat reads as unattached.
  canvasWorkspace = workspace;
  return workspace;
});
void canvasReady.catch((error: unknown) => {
  server.broadcast({
    type: 'error',
    code: 'canvas.storage_failed',
    message: `Canvas storage did not open, so no board is available until DROIDEX restarts: ${error instanceof Error ? error.message : String(error)}`,
  });
});
const handleCanvasCommand = createCanvasCommandHandler(
  canvasReady,
  canvasScopes,
  canvasBuilds,
  (event) => {
    server.broadcast(event);
  },
  (listener) => server.onPageGone(listener),
);

automationManager = configureAutomationManager({
  dataDir: droidexUserDataDir(),
  emit: (event) => {
    server.broadcast(event);
  },
  launchSession: (command) => manager.handle(command),
  deliverMessage: (id, prompt, isCurrent) => manager.deliverScheduledMessage(id, prompt, isCurrent),
  closeSession: (appSessionId) => manager.handle({ type: 'session.close', appSessionId }),
  resolveSessionContext: (appSessionId) => manager.automationSessionContext(appSessionId),
  validateSelection: (modelId, reasoningEffort) =>
    manager.validateAutomationSelection(modelId, reasoningEffort),
});

let shuttingDown = false;

server.ready
  .then(() => {
    hotPathMetrics.enable();
    hotPathMetrics.setGaugeProvider(() => manager.resourceCounts());
    // Stdout line consumed by the desktop supervisor to confirm readiness.
    process.stdout.write(`SIDECAR_READY ${String(server.port)}\n`);
    // Yield so the supervisor observes ready before the search isolate starts.
    setImmediate(() => {
      if (shuttingDown) return;
      manager.startSessionFileServing();
      // Projects deliver only once history can resolve the threads they wake.
      void Promise.all([
        // A ledger that failed to open is reported where it opens.
        projectsReady.catch(() => undefined),
        manager.whenSessionHistoryReady(),
      ]).then(
        ([service]) => {
          service?.historyReady();
        },
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          reportProjectError(
            new Error(
              `Session history did not load, so Projects deliver nothing until DROIDEX restarts: ${reason}`,
            ),
          );
        },
      );
    });
  })
  .catch((error: unknown) => {
    console.error(
      `Sidecar bridge failed to listen: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  projects?.close();
  const forceExit = setTimeout(() => process.exit(1), 5_000);
  forceExit.unref();
  try {
    // Sessions close first so the automation store records their final run state
    // before it flushes. Bridge close is bounded and flushes its ordered queue
    // after shutdown.
    await shutdownSidecar({
      shutdownSessions: () => manager.shutdown(),
      shutdownAutomations: async () => {
        try {
          await automationManager?.shutdown();
        } finally {
          const service = await projectsReady.catch(() => undefined);
          await service?.flush();
        }
      },
      // After the sessions, because an agent's Canvas mutation runs under one.
      shutdownCanvas: async () => {
        // Builds first: a settling build still reports its outcome through the
        // workspace, which then waits for that commit before it closes.
        await canvasBuilds.close();
        const workspace = await canvasReady.catch(() => undefined);
        await workspace?.close();
      },
      disableMetrics: () => {
        hotPathMetrics.disable();
      },
      closeBridge: () => server.close(),
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
  clearTimeout(forceExit);
  process.exit();
}

function requiredSecret(name: 'BRIDGE_TOKEN' | 'BROWSER_ASSET_TOKEN'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function bridgePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`BRIDGE_PORT must be an integer from 0 to 65535; received ${value}.`);
  }
  return port;
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
if (EXIT_ON_STDIN_CLOSE) {
  process.stdin.resume();
  process.stdin.once('end', () => void shutdown());
  process.stdin.once('close', () => void shutdown());
}
