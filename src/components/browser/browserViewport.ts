import type { BrowserViewport, BrowserViewportMode } from '../../types/bridge';
import type { Size } from './browserGeometry';

const FIT_FALLBACK_VIEWPORT: BrowserViewport = {
  width: 1200,
  height: 800,
  deviceScaleFactor: 2,
};

// The standard sizes; the sidecar has the same ones for agents.
const PRESET_VIEWPORTS: Record<Exclude<BrowserViewportMode, 'fit'>, BrowserViewport> = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2 },
  laptop: { width: 1280, height: 800, deviceScaleFactor: 2 },
  tablet: { width: 820, height: 1180, deviceScaleFactor: 2 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2 },
};

export const VIEWPORT_LABELS: Record<BrowserViewportMode, string> = {
  fit: 'Fit',
  desktop: 'Desktop',
  laptop: 'Laptop',
  tablet: 'Tablet',
  mobile: 'Phone',
};

export function viewportFromFrame(size: Size): BrowserViewport {
  if (size.width <= 1 || size.height <= 1) return FIT_FALLBACK_VIEWPORT;
  return {
    width: pixels(size.width),
    height: pixels(size.height),
    deviceScaleFactor: 2,
  };
}

export function viewportForMode(
  mode: BrowserViewportMode,
  fitViewport: BrowserViewport,
): BrowserViewport {
  return mode === 'fit' ? fitViewport : PRESET_VIEWPORTS[mode];
}

const PAGE_PADDING = 18;

/**
 * Where the page sits in the pane. Fit fills it edge to edge; a standard size keeps its own CSS size, scaled down to fit and
 * centred, so the page lays out exactly as the agent sees it.
 */
export function pageLayout(
  frame: Size,
  viewport: BrowserViewport,
  mode: BrowserViewportMode,
): Size & { left: number; top: number; scale?: number } {
  if (mode === 'fit') {
    return { width: pixels(frame.width), height: pixels(frame.height), left: 0, top: 0 };
  }
  const availableWidth = Math.max(1, frame.width - PAGE_PADDING * 2);
  const availableHeight = Math.max(1, frame.height - PAGE_PADDING * 2);
  const scale = Math.min(1, availableWidth / viewport.width, availableHeight / viewport.height);
  const width = viewport.width * scale;
  const height = viewport.height * scale;
  return {
    width: Math.round(width),
    height: Math.round(height),
    left: Math.round((frame.width - width) / 2),
    top: Math.round((frame.height - height) / 2),
    scale,
  };
}

export function sameViewport(a: BrowserViewport, b: BrowserViewport): boolean {
  return (
    a.width === b.width && a.height === b.height && a.deviceScaleFactor === b.deviceScaleFactor
  );
}

/** Where text typed in the address bar that is not an address is searched. */
export const SEARCH_URL = 'https://www.google.com/search?q=';

export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'about:blank';
  if (/^(https?:|file:|about:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  const ipv6Loopback = normalizeBareIpv6Loopback(trimmed);
  if (ipv6Loopback) return ipv6Loopback;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/|$)/i.test(trimmed))
    return `http://${trimmed}`;
  // As in a browser's address bar, the part before the first /, ? or # decides,
  // read by the URL parser itself: a host with a dot, an IP or a port makes the
  // whole input a site, any login and spaces in its path included; anything
  // else is a search.
  const authority = trimmed.split(/[/?#]/, 1)[0];
  if (!/\s/.test(authority) && URL.canParse(`https://${authority}`)) {
    const { hostname, port } = new URL(`https://${authority}`);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return `http://${trimmed}`;
    if (hostname.includes('.') || hostname.startsWith('[') || port) return `https://${trimmed}`;
  }
  return `${SEARCH_URL}${encodeURIComponent(trimmed)}`;
}

function normalizeBareIpv6Loopback(value: string): string | null {
  const match = /^::1(?::(\d+))?(\/.*)?$/i.exec(value);
  if (!match) return null;
  const port = match[1] ? `:${match[1]}` : '';
  const path = match[2] ?? '';
  return `http://[::1]${port}${path}`;
}

function pixels(value: number): number {
  return Math.max(1, Math.round(value));
}
