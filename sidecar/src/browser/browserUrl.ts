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
// secret, in a URL passed as a parameter's value too. The raw address stays
// with the browser for navigation and matching.
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
  const params = [...url.searchParams];
  const redacted = params.map(([key, inner]): [string, string] => [
    key,
    redactParameter(key, inner, depth),
  ]);
  if (redacted.some(([, inner], index) => inner !== params[index][1]))
    url.search = new URLSearchParams(redacted).toString();
  url.username = '';
  url.password = '';
  url.hash = '';
  return url.href;
}

function redactParameter(key: string, value: string, depth: number): string {
  const name = key.toLowerCase();
  // `sig` alone is the signature of a signed URL.
  if (name === 'sig' || SENSITIVE_KEY_PARTS.some((part) => name.includes(part)))
    return '[redacted]';
  if (!URL.canParse(value)) return value;
  return depth < MAX_URL_DEPTH ? redactBrowserUrl(value, depth + 1) : '[redacted]';
}
