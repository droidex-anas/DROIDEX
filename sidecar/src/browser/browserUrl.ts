export function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'about:blank';
  if (/^(https?:|file:|about:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  const ipv6Loopback = normalizeBareIpv6Loopback(trimmed);
  if (ipv6Loopback) return ipv6Loopback;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?(\/|$)/i.test(trimmed))
    return `http://${trimmed}`;
  return `https://${trimmed}`;
}

function normalizeBareIpv6Loopback(value: string): string | null {
  const match = /^::1(?::(\d+))?(\/.*)?$/i.exec(value);
  if (!match) return null;
  const port = match[1] ? `:${match[1]}` : '';
  const path = match[2] ?? '';
  return `http://[::1]${port}${path}`;
}

// A page address as an agent reads it, by the policy the desktop app applies
// to the addresses in browser tool output (electron/browserDiagnostics.cjs):
// no user, password or fragment, and no value for a parameter named like a
// secret, in a URL passed as a parameter's value too, relative or absolute.
// A page that is not on the web (a local file) shows only its scheme. The raw
// address stays with the browser for navigation and matching.
const SENSITIVE_KEY_PARTS = [
  'token',
  'key',
  'secret',
  'password',
  'passcode',
  'auth',
  'authorization',
  'signature',
  'credential',
  'code',
  'cookie',
  'session',
  'csrf',
  'otp',
];
// A URL nested deeper than this in parameters goes whole.
const MAX_URL_DEPTH = 3;

export function redactBrowserUrl(value: string, depth = 0): string {
  if (!URL.canParse(value)) return value.slice(0, 1000);
  const url = new URL(value);
  if (depth === 0 && !/^(https?|about):$/.test(url.protocol)) return `${url.protocol}[hidden]`;
  const params = [...url.searchParams];
  const redacted = params.map(([key, inner]): [string, string] => [
    key,
    redactParameter(key, inner, url.href, depth),
  ]);
  if (redacted.some(([, inner], index) => inner !== params[index][1]))
    url.search = new URLSearchParams(redacted).toString();
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.href;
}

function redactParameter(key: string, value: string, base: string, depth: number): string {
  const name = key.toLowerCase();
  // `sig` alone is the signature of a signed URL.
  if (name === 'sig' || SENSITIVE_KEY_PARTS.some((part) => name.includes(part)))
    return '[redacted]';
  // A relative URL (`next=/continue?code=...`) is read against the page's own.
  const relative = value.startsWith('/') || value.startsWith('?');
  if (!relative && !URL.canParse(value)) return value;
  // One that looks like a URL but will not read as one goes whole.
  if (depth >= MAX_URL_DEPTH || !URL.canParse(value, base)) return '[redacted]';
  const resolved = new URL(value, base).href;
  const redacted = redactBrowserUrl(resolved, depth + 1);
  return redacted === resolved ? value : redacted;
}
