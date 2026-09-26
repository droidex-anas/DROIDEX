/**
 * Site icons for transcript links and provider catalogs.
 *
 * The main process discovers favicons by host or fetches a catalog's exact URL.
 * Both are served through `droidex-favicon://`, never fetched by the renderer.
 * The renderer never contacts arbitrary origins itself, and Node's fetch keeps
 * these requests out of every browsing session, so no cookies are sent.
 *
 * Rendering a message must not become a way to make the app probe the user's
 * network, so only public HTTPS hosts on the default port are contacted: IP
 * literals, local and reserved names, and names that resolve to private
 * addresses are refused, and every redirect is checked the same way. Bodies are
 * size-capped and must sniff as an image. A site's answer — including "no
 * usable icon" — is cached on disk; a network failure is not, so being offline
 * once does not blank every icon for a day.
 *
 * Kept free of `require('electron')` so it runs under plain Node.
 */

const { createHash } = require('node:crypto');
const dns = require('node:dns/promises');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');

const FAVICON_SCHEME = 'droidex-favicon';
const MAX_PAGE_BYTES = 256 * 1024;
// A product logo is sometimes a megabyte of PNG: a cap that refuses one costs
// the row its real icon and leaves a placeholder glyph in its place.
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 5 * 60 * 1000;
// Icons kept in memory; older hosts fall back to the disk cache. Both bounds
// hold, so neither many small icons nor a few large ones can grow the cache.
const SETTLED_LIMIT = 256;
const SETTLED_BYTES = 32 * 1024 * 1024;
const RESERVED_TLDS = new Set([
  'localhost',
  'local',
  'internal',
  'lan',
  'home',
  'corp',
  'intranet',
  'private',
  'test',
  'example',
  'invalid',
  'onion',
  'arpa',
]);

// A definitive answer — no icon, not an image, refused by policy — as opposed
// to a network failure that is worth asking about again later.
class IconUnavailable extends Error {}

function isPublicHostname(host) {
  if (host.length > 253 || net.isIP(host) !== 0) return false;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return false;
  return !RESERVED_TLDS.has(host.slice(host.lastIndexOf('.') + 1));
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const mappedIPv4 = ipv4MappedIn(address.toLowerCase());
  if (mappedIPv4) return isPrivateAddress(mappedIPv4);
  const groups = expandIPv6(address.toLowerCase());
  if (!groups) return true;
  const lower = groups.join(':');
  return (
    lower === '0:0:0:0:0:0:0:0' ||
    lower === '0:0:0:0:0:0:0:1' ||
    /^f[cd]/.test(groups[0]) ||
    /^fe[89ab]/.test(groups[0].padStart(4, '0'))
  );
}

// The eight hex groups of an IPv6 address with `::` expanded and any trailing
// dotted IPv4 folded in, or null when it is not one. Unparseable input is
// treated as private by the caller: better no icon than a guessed target.
function expandIPv6(address) {
  let text = address;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.replace(/^0+(?=.)/, ''));
}

// The IPv4 address an IPv4-mapped IPv6 address names, whatever notation it
// arrived in (`::ffff:127.0.0.1`, `::ffff:7f00:1`, `0:0:0:0:0:ffff:7f00:1`).
function ipv4MappedIn(address) {
  const groups = expandIPv6(address);
  if (!groups || groups.slice(0, 5).some((group) => group !== '0') || groups[5] !== 'ffff') {
    return null;
  }
  const high = Number.parseInt(groups[6], 16);
  const low = Number.parseInt(groups[7], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/** The public host or exact icon URL carried by a favicon request. */
function faviconRequestTarget(requestUrl) {
  const url = new URL(requestUrl);
  if (url.protocol !== `${FAVICON_SCHEME}:`) throw new Error(`Unsupported scheme: ${url.protocol}`);
  if (url.username || url.password || url.port) throw new Error('Invalid icon request');
  if (url.hostname === 'icon' && url.pathname === '/') {
    const target = new URL(url.searchParams.get('url') ?? '');
    assertPublicUrl(target);
    target.hash = '';
    return target;
  }
  const host = url.hostname.toLowerCase();
  if (!isPublicHostname(host)) throw new Error(`Not a public host: ${host}`);
  return host;
}

function assertPublicUrl(url) {
  if (
    url.protocol !== 'https:' ||
    (url.port !== '' && url.port !== '443') ||
    url.username ||
    url.password
  ) {
    throw new IconUnavailable('Icons require credential-free HTTPS on the default port');
  }
  if (!isPublicHostname(url.hostname.toLowerCase())) {
    throw new IconUnavailable('Icon host is not public');
  }
}

async function assertPublicTarget(url, lookup) {
  assertPublicUrl(url);
  const host = url.hostname.toLowerCase();
  const addresses = await lookup(host, { all: true });
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new IconUnavailable(`Refusing ${host}: it resolves to a private address`);
  }
}

// A page is only needed as far as its <head>, so it is cut off at the cap; an
// icon over the cap is not an icon worth showing.
async function readBody(response, maxBytes, truncate) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      if (!truncate) throw new IconUnavailable('Body exceeds the size cap');
      chunks.push(Buffer.from(chunk).subarray(0, chunk.byteLength - (total - maxBytes)));
      break;
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchFollowing(start, options) {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicTarget(url, options.lookup);
    const response = await options.fetchImpl(url.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: options.accept, 'user-agent': options.userAgent },
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new IconUnavailable(`${url.href} answered ${String(response.status)}`);
    }
    const body = await readBody(response, options.maxBytes, options.truncate);
    return { url, body, contentType: response.headers.get('content-type') ?? '' };
  }
  throw new IconUnavailable(`Too many redirects from ${start.href}`);
}

const LINK_TAG = /<link\b[^>]*>/gi;

function attributeOf(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(
    tag,
  );
  return match ? (match[1] ?? match[2] ?? match[3]).trim() : '';
}

// Ranks the icons a page declares for a 14px mark on a dark transcript. A
// raster icon drawn at 32px or more comes first: SVG favicons are usually drawn
// for light browser tabs — MDN's is a black glyph on transparent — and vanish
// against a dark background, while sized raster icons tend to carry their own
// backdrop. Then SVG, then any icon, then the touch icon as a last resort.
function iconRank(tag, href) {
  const rel = attributeOf(tag, 'rel').toLowerCase().split(/\s+/);
  const isIcon = rel.includes('icon');
  if (!isIcon && !rel.includes('apple-touch-icon')) return 0;
  const isSvg = attributeOf(tag, 'type').includes('svg') || /\.svg(?:[?#]|$)/i.test(href);
  const sizes = (attributeOf(tag, 'sizes').match(/\d+/g) ?? []).map(Number);
  if (isIcon && !isSvg && sizes.some((size) => size >= 32)) return 4;
  if (isSvg) return 3;
  return isIcon ? 2 : 1;
}

function declaredIcons(html, pageUrl) {
  const found = [];
  for (const tag of html.match(LINK_TAG) ?? []) {
    const href = attributeOf(tag, 'href').replace(/&amp;/g, '&');
    const rank = href ? iconRank(tag, href) : 0;
    if (rank > 0 && URL.canParse(href, pageUrl)) found.push({ rank, url: new URL(href, pageUrl) });
  }
  // Stable sort: among equal ranks the page's own order wins.
  return found.sort((a, b) => b.rank - a.rank).map((entry) => entry.url);
}

function sniffImage(body, contentType) {
  const ascii = (start, end) => body.subarray(start, end).toString('latin1');
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (body[0] === 0 && body[1] === 0 && (body[2] === 1 || body[2] === 2) && body[3] === 0) {
    return 'image/x-icon';
  }
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  const text = body.subarray(0, 2048).toString('utf8').trimStart().toLowerCase();
  const looksSvg =
    contentType.includes('svg') || text.startsWith('<svg') || text.startsWith('<?xml');
  return looksSvg && text.includes('<svg') ? 'image/svg+xml' : null;
}

function createFaviconStore({
  cacheDir,
  userAgent,
  logError,
  fetchImpl = fetch,
  lookup = dns.lookup,
  fs = fsp,
  now = Date.now,
}) {
  const settled = new Map();
  let settledBytes = 0;
  const inFlight = new Map();
  const retryAfter = new Map();
  const request = { fetchImpl, lookup, userAgent };

  async function fetchImage(url) {
    try {
      const icon = await fetchFollowing(url, {
        ...request,
        accept: 'image/*',
        maxBytes: MAX_ICON_BYTES,
        truncate: false,
      });
      const mime = sniffImage(icon.body, icon.contentType);
      return mime ? { mime, data: icon.body } : null;
    } catch (error) {
      if (!(error instanceof IconUnavailable)) throw error;
      return null;
    }
  }

  async function fetchIcon(target) {
    if (target instanceof URL) return fetchImage(target);
    const origin = new URL(`https://${target}/`);
    const candidates = [];
    try {
      const page = await fetchFollowing(origin, {
        ...request,
        accept: 'text/html',
        maxBytes: MAX_PAGE_BYTES,
        truncate: true,
      });
      candidates.push(...declaredIcons(page.body.toString('utf8'), page.url));
    } catch (error) {
      if (!(error instanceof IconUnavailable)) throw error;
    }
    candidates.push(new URL('/favicon.ico', origin));
    const tried = new Set();
    for (const url of candidates) {
      if (tried.has(url.href)) continue;
      tried.add(url.href);
      const icon = await fetchImage(url);
      if (icon) return icon;
    }
    return null;
  }

  const cacheFiles = (host) => ({
    meta: path.join(cacheDir, `${host}.json`),
    icon: path.join(cacheDir, `${host}.icon`),
  });

  // undefined: nothing usable on disk. null: the site was asked and has no icon.
  async function readCached(host) {
    const files = cacheFiles(host);
    let record;
    try {
      record = JSON.parse(await fs.readFile(files.meta, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT')
        logError(`Discarding the unreadable cache for ${host}: ${error.message}`);
      return undefined;
    }
    const ttl = record.mime ? FOUND_TTL_MS : MISSING_TTL_MS;
    if (typeof record.fetchedAt !== 'number' || now() - record.fetchedAt > ttl) return undefined;
    if (!record.mime) return null;
    try {
      return { mime: record.mime, data: await fs.readFile(files.icon) };
    } catch (error) {
      logError(`The cached icon for ${host} is gone: ${error.message}`);
      return undefined;
    }
  }

  async function writeCached(host, found) {
    const files = cacheFiles(host);
    await fs.mkdir(cacheDir, { recursive: true });
    if (found) await fs.writeFile(files.icon, found.data);
    await fs.writeFile(files.meta, JSON.stringify({ mime: found?.mime ?? null, fetchedAt: now() }));
  }

  async function resolveIcon(target, key) {
    const cached = await readCached(key);
    if (cached !== undefined) return cached;
    const found = await fetchIcon(target);
    await writeCached(key, found).catch((error) => {
      logError(`Could not cache the icon for ${key}: ${error.message}`);
    });
    return found;
  }

  // Newest in, oldest out, until both bounds hold again.
  function remember(key, found) {
    settled.set(key, found);
    settledBytes += found?.data.byteLength ?? 0;
    while (settled.size > SETTLED_LIMIT || settledBytes > SETTLED_BYTES) {
      const oldest = settled.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      settledBytes -= settled.get(oldest)?.data.byteLength ?? 0;
      settled.delete(oldest);
    }
  }

  /** A host's favicon or an exact public HTTPS image, fetched lazily. */
  function load(target) {
    const key =
      target instanceof URL
        ? `url-${createHash('sha256').update(target.href).digest('hex')}`
        : target;
    if (settled.has(key)) return Promise.resolve(settled.get(key));
    if ((retryAfter.get(key) ?? 0) > now()) return Promise.resolve(null);
    let pending = inFlight.get(key);
    if (!pending) {
      pending = resolveIcon(target, key)
        .then((found) => {
          remember(key, found);
          return found;
        })
        .catch(() => {
          retryAfter.set(key, now() + RETRY_AFTER_MS);
          logError(`Could not fetch the icon for ${key}; retrying later`);
          return null;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    return pending;
  }

  return { load };
}

module.exports = { FAVICON_SCHEME, createFaviconStore, faviconRequestTarget };
