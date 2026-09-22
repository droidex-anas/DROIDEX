/**
 * Anonymous installation telemetry.
 *
 * DROIDEX reports two things and nothing else: that a packaged app was opened,
 * and that an installation was seen for the first time. Both carry a random
 * installation UUID minted by the main process and a fixed set of build facts.
 * No prompt, message, file, path, repository, project name, account, or input
 * value is collected, and Datadog's automatic instrumentation that could pick
 * such data up is turned off rather than filtered after the fact.
 *
 * The main process decides whether any of this runs at all (packaged build,
 * configured credentials, and the user's consent); this module only carries out
 * that decision. Every failure here is swallowed: telemetry must never be able
 * to keep the app from starting.
 */

const SERVICE = 'droidex';
const ENVIRONMENT = 'production';

// Datadog records a view URL for every event. In Electron that URL is a local
// file path, so views are started manually under a fixed name and any URL that
// still reaches an event is replaced before it leaves the app.
const VIEW_NAME = 'app';
const SCRUBBED_URL = 'app://droidex';

// The only custom attributes allowed to leave the app. Action attributes reach
// Datadog as `event.context`, so this list is what actually bounds the payload
// rather than the call sites that build it.
const ALLOWED_CONTEXT_KEYS = new Set([
  'app_version',
  'platform',
  'architecture',
  'distribution_channel',
  'install_origin',
]);

interface UsageAnalyticsContext {
  app_version: string;
  platform: string;
  architecture: string;
  distribution_channel: string;
}

export interface UsageAnalyticsBootstrap {
  enabled: boolean;
  applicationId?: string;
  clientToken?: string;
  site?: string;
  version?: string;
  installationId?: string;
  firstLaunch?: boolean;
  installOrigin?: string;
  context?: UsageAnalyticsContext;
}

interface RumApi {
  init: (config: Record<string, unknown>) => void;
  setUser: (user: { id: string }) => void;
  startView: (view: { name: string }) => void;
  addAction: (name: string, context?: Record<string, unknown>) => void;
  stopSession: () => void;
}

interface UsageAnalyticsDeps {
  bootstrap?: () => Promise<unknown>;
  reportFirstLaunch?: () => Promise<unknown>;
  loadRum?: () => Promise<RumApi>;
}

type UsageAnalyticsOutcome = 'started' | 'disabled' | 'failed';

let hasStarted = false;
// The running client, if any, and whether it may still send. Opting out flips
// this for the rest of the launch; the next launch never starts a client.
let client: RumApi | null = null;
let reportingAllowed = true;

export async function startUsageAnalytics(
  deps: UsageAnalyticsDeps = {},
): Promise<UsageAnalyticsOutcome> {
  if (hasStarted) return 'disabled';
  try {
    const bootstrap = normalizeBootstrap(
      await (deps.bootstrap ?? (() => callBridge('usageAnalyticsBootstrap')))(),
    );
    if (!bootstrap) return 'disabled';
    hasStarted = true;

    const rum = await (deps.loadRum ?? loadRum)();
    // Opting out while the SDK was still loading has to stop the launch here.
    // Starting a view emits a view event, and Datadog does not let beforeSend
    // discard those, so the only way not to send one is never to start it.
    if (!reportingAllowed) return 'disabled';
    client = rum;
    rum.init(buildRumConfig(bootstrap));
    rum.setUser({ id: bootstrap.installationId });
    rum.startView({ name: VIEW_NAME });

    rum.addAction('app_opened', { ...bootstrap.context });
    if (bootstrap.firstLaunch) {
      rum.addAction('install_first_launch', {
        ...bootstrap.context,
        install_origin: bootstrap.installOrigin,
      });
      await (deps.reportFirstLaunch ?? (() => callBridge('usageAnalyticsFirstLaunchReported')))();
    }
    return 'started';
  } catch {
    // A missing bridge, absent configuration, a blocked network, or an SDK that
    // fails to load all mean the same thing: no telemetry this launch.
    return 'failed';
  }
}

export function buildRumConfig(bootstrap: ResolvedBootstrap): Record<string, unknown> {
  return {
    applicationId: bootstrap.applicationId,
    clientToken: bootstrap.clientToken,
    site: bootstrap.site,
    service: SERVICE,
    env: ENVIRONMENT,
    version: bootstrap.version,
    sessionSampleRate: 100,
    // Packaged DROIDEX loads the renderer with loadFile(), so the page runs on
    // a file:// origin where cookies are unavailable. Without this the SDK
    // cannot persist a session, and telemetry would be broken in exactly the
    // builds that report it. See Datadog's "Monitor Electron Applications
    // Using the Browser SDK" guide.
    sessionPersistence: 'local-storage',
    // Session Replay is never recorded: it is not sampled, it is not started,
    // and the slim SDK does not carry the recorder at all.
    sessionReplaySampleRate: 0,
    defaultPrivacyLevel: 'mask',
    // One identifier per installation: the SDK's own anonymous user id would be
    // a second, equally stable one, and nothing here needs it.
    trackAnonymousUser: false,
    // Automatic collection that could observe user content or local paths.
    trackUserInteractions: false,
    trackResources: false,
    trackLongTasks: false,
    trackViewsManually: true,
    telemetrySampleRate: 0,
    beforeSend: sanitizeRumEvent,
  };
}

/**
 * Last line of defence before an event leaves the app. Drops anything that is
 * not one of the two actions or their view, and strips the local URLs Datadog
 * attaches automatically.
 */
export function sanitizeRumEvent(event: unknown): boolean {
  if (!reportingAllowed || !event || typeof event !== 'object') return false;
  const record = event as MutableRumEvent;
  if (record.type !== 'action' && record.type !== 'view') return false;

  const view = record.view;
  if (view && typeof view === 'object') {
    const viewRecord = view as MutableRumView;
    if ('url' in viewRecord) viewRecord.url = SCRUBBED_URL;
    if ('referrer' in viewRecord) viewRecord.referrer = SCRUBBED_URL;
    if ('name' in viewRecord) viewRecord.name = VIEW_NAME;
  }
  const context = record.context;
  if (context && typeof context === 'object') {
    record.context = Object.fromEntries(
      Object.entries(context).filter(([key]) => ALLOWED_CONTEXT_KEYS.has(key)),
    );
  }
  if (typeof record.referrer === 'string') record.referrer = SCRUBBED_URL;
  return true;
}

/** The parts of a RUM event this module inspects; everything else passes through. */
interface MutableRumEvent {
  type?: unknown;
  view?: unknown;
  context?: Record<string, unknown>;
  referrer?: unknown;
}

interface MutableRumView {
  url?: unknown;
  referrer?: unknown;
  name?: unknown;
}

interface ResolvedBootstrap {
  applicationId: string;
  clientToken: string;
  site: string;
  version: string;
  installationId: string;
  firstLaunch: boolean;
  installOrigin: string;
  context: UsageAnalyticsContext;
}

/** Returns null whenever the payload does not fully describe an enabled build. */
export function normalizeBootstrap(value: unknown): ResolvedBootstrap | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as UsageAnalyticsBootstrap;
  if (typeof payload.enabled !== 'boolean' || !payload.enabled) return null;
  const applicationId = text(payload.applicationId);
  const clientToken = text(payload.clientToken);
  const site = text(payload.site);
  const installationId = text(payload.installationId);
  if (!applicationId || !clientToken || !site || !installationId) return null;
  const context = payload.context;
  if (!context || typeof context !== 'object') return null;
  return {
    applicationId,
    clientToken,
    site,
    version: text(payload.version) || '0.0.0',
    installationId,
    firstLaunch: payload.firstLaunch === true,
    installOrigin: text(payload.installOrigin) || 'unknown',
    context: {
      app_version: text(context.app_version),
      platform: text(context.platform),
      architecture: text(context.architecture),
      distribution_channel: text(context.distribution_channel),
    },
  };
}

// Outside the desktop app there is no bridge; the toggle simply reads as off.
const OFF = { enabled: false };

export async function getUsageAnalyticsPreference(): Promise<{ enabled: boolean }> {
  return normalizePreference((await callBridge('getUsageAnalytics')) ?? OFF);
}

export async function setUsageAnalyticsPreference(enabled: boolean): Promise<{ enabled: boolean }> {
  const preference = normalizePreference((await callBridge('setUsageAnalytics', [enabled])) ?? OFF);
  if (!preference.enabled) {
    reportingAllowed = false;
    client?.stopSession();
  }
  return preference;
}

// Resolves to null when the desktop bridge or the method is missing, which every
// caller already treats as "not available".
function callBridge(name: string, args: unknown[] = []): Promise<unknown> {
  const bridge = window.droidControl;
  const method: unknown = bridge ? Reflect.get(bridge, name) : undefined;
  if (typeof method !== 'function') return Promise.resolve(null);
  return Promise.resolve(Reflect.apply(method, bridge, args) as unknown);
}

function normalizePreference(value: unknown): { enabled: boolean } {
  if (!value || typeof value !== 'object' || !('enabled' in value)) {
    throw new Error('Usage analytics preference response is invalid.');
  }
  const enabled = Reflect.get(value, 'enabled');
  if (typeof enabled !== 'boolean') {
    throw new Error('Usage analytics preference response is invalid.');
  }
  return { enabled };
}

/** @internal Reset module state for deterministic tests. */
export function __resetUsageAnalyticsForTest(): void {
  hasStarted = false;
  client = null;
  reportingAllowed = true;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function loadRum(): Promise<RumApi> {
  // Loaded lazily so the SDK never lands in the initial renderer bundle and is
  // never downloaded by builds that report nothing.
  const module = await import('@datadog/browser-rum-slim');
  return module.datadogRum as unknown as RumApi;
}
