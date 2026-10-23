interface HighEntropyHints {
  model?: string;
  platformVersion?: string;
}

declare global {
  interface Navigator {
    userAgentData?: { getHighEntropyValues(hints: string[]): Promise<HighEntropyHints> };
  }
}

interface DeviceSignals extends HighEntropyHints {
  userAgent: string;
  maxTouchPoints: number;
}

const BROWSERS: [RegExp, string][] = [
  [/EdgiOS|EdgA|Edg\//, 'Edge'],
  [/OPiOS|OPR\//, 'Opera'],
  [/SamsungBrowser/, 'Samsung Internet'],
  [/CriOS|Chrome\//, 'Chrome'],
  [/FxiOS|Firefox\//, 'Firefox'],
  [/Safari\//, 'Safari'],
];

function browserName(userAgent: string): string {
  return BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? 'Browser';
}

function major(version: string | undefined): string | undefined {
  const value = version?.split(/[._]/)[0];
  return value && value !== '0' ? value : undefined;
}

function iosVersion(userAgent: string): string | undefined {
  // Safari's Version/ token tracks the iOS major. The OS token froze at 18_6 in iOS 26,
  // so without Version/ that value cannot be trusted.
  const safari = major(/Version\/([\d.]+)/.exec(userAgent)?.[1]);
  if (safari) return safari;
  const os = /OS (\d+_\d+)/.exec(userAgent)?.[1];
  return os && os !== '18_6' ? major(os) : undefined;
}

// Chrome's reduced user agent reports "Android 10; K" for every phone; Firefox sends "Mobile".
const GENERIC_ANDROID_TOKENS = new Set(['K', 'Mobile', 'Tablet']);

function androidDevice(signals: DeviceSignals): { model: string; version?: string } {
  const match = /Android ([\d.]+);\s*([^;)]+)/.exec(signals.userAgent);
  const token = match?.[2]?.trim();
  const reduced = token === 'K';
  const tokenModel = token && !GENERIC_ANDROID_TOKENS.has(token) ? token : undefined;
  // Desktop Chrome sends an empty model hint.
  const model = signals.model?.length ? signals.model : tokenModel;
  const version = major(signals.platformVersion) ?? (reduced ? undefined : major(match?.[1]));
  return { model: model ? model.slice(0, 40) : 'Android phone', version };
}

const DESKTOPS: [string, string][] = [
  ['CrOS', 'Chromebook'],
  ['Macintosh', 'Mac'],
  ['Windows', 'Windows'],
  ['Linux', 'Linux'],
];

function named(browser: string, device: string, os?: string): string {
  return os ? `${browser} on ${device} (${os})` : `${browser} on ${device}`;
}

export function describeDevice(signals: DeviceSignals): string {
  const { userAgent } = signals;
  const browser = browserName(userAgent);
  const isIPad =
    userAgent.includes('iPad') || (userAgent.includes('Macintosh') && signals.maxTouchPoints > 1);
  if (isIPad || /iPhone|iPod/.test(userAgent)) {
    const version = iosVersion(userAgent);
    if (isIPad) return named(browser, 'iPad', version && `iPadOS ${version}`);
    return named(browser, 'iPhone', version && `iOS ${version}`);
  }
  if (userAgent.includes('Android')) {
    const { model, version } = androidDevice(signals);
    return named(browser, model, version && `Android ${version}`);
  }
  const desktop = DESKTOPS.find(([token]) => userAgent.includes(token))?.[1];
  if (desktop) return named(browser, desktop);
  return browser === 'Browser' ? 'Web browser' : browser;
}

export async function currentDeviceName(): Promise<string> {
  const hints = await navigator.userAgentData
    ?.getHighEntropyValues(['model', 'platformVersion'])
    .catch(() => undefined);
  return describeDevice({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    model: hints?.model,
    platformVersion: hints?.platformVersion,
  });
}
