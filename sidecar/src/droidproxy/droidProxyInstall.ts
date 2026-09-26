import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { access, constants, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { DroidProxyInstallPhase } from '../protocol.js';
import {
  droidProxyAppPath,
  droidProxyBundleComplete,
  droidProxyInstallUnavailable,
} from './droidProxy.js';

const execFileAsync = promisify(execFile);

const DROIDPROXY_ZIP_URL =
  'https://github.com/anand-92/droidproxy/releases/latest/download/DroidProxy-arm64.zip';
const DROIDPROXY_SHA_URL =
  'https://github.com/anand-92/droidproxy/releases/latest/download/DroidProxy-arm64.zip.sha256';
// The release zip is ~25MB; refuse anything absurd before it fills the disk.
const MAX_ZIP_BYTES = 500_000_000;
const FETCH_TIMEOUT_MS = 10 * 60 * 1000;
const DITTO_TIMEOUT_MS = 120_000;

export interface DroidProxyInstallProgress {
  phase: DroidProxyInstallPhase;
  receivedBytes?: number;
  totalBytes?: number;
}

export type DroidProxyInstallResult =
  | { ok: true }
  | { ok: false; cancelled?: boolean; message: string };

// First token of the release's sha256 file (`<hash>  <filename>`), validated
// as hex so a proxy error page never passes as a checksum.
export function parseSha256File(text: string): string | undefined {
  const token = text.trim().split(/\s+/)[0];
  return token && /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : undefined;
}

export async function sha256FileHex(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Uint8Array);
  }
  return hash.digest('hex');
}

function contentLength(response: Response): number | undefined {
  const raw = response.headers.get('content-length');
  if (!raw) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export async function downloadFile(
  url: string,
  destPath: string,
  onProgress: (receivedBytes: number, totalBytes: number | undefined) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (HTTP ${String(response.status)}).`);
  }
  const total = contentLength(response);
  if (total !== undefined && total > MAX_ZIP_BYTES) {
    throw new Error('Download is larger than expected.');
  }
  const file = createWriteStream(destPath);
  let received = 0;
  try {
    for await (const chunk of response.body) {
      received += (chunk as Uint8Array).length;
      if (received > MAX_ZIP_BYTES) {
        throw new Error('Download is larger than expected.');
      }
      if (!file.write(chunk)) {
        await new Promise<void>((resolve) =>
          file.once('drain', () => {
            resolve();
          }),
        );
      }
      onProgress(received, total);
    }
  } finally {
    file.end();
  }
  await new Promise<void>((resolve, reject) => {
    file.on('finish', () => {
      resolve();
    });
    file.on('error', reject);
  });
}

// /Applications for admin users, ~/Applications otherwise: both keep the
// install inside user-writable space, so no elevation prompt ever appears.
async function installTarget(): Promise<string | undefined> {
  for (const dir of ['/Applications', join(homedir(), 'Applications')]) {
    try {
      await access(dir, constants.W_OK);
      return join(dir, 'DroidProxy.app');
    } catch {
      continue;
    }
  }
  const homeApps = join(homedir(), 'Applications');
  try {
    await mkdir(homeApps, { recursive: true });
    return join(homeApps, 'DroidProxy.app');
  } catch {
    return undefined;
  }
}

// Downloads, verifies, and installs the DroidProxy app without leaving the
// settings page. Never overwrites an existing install; launching and model
// setup stay with the controller so progress phases read in order.
export async function installDroidProxyApp(
  onProgress: (progress: DroidProxyInstallProgress) => void,
  signal?: AbortSignal,
): Promise<DroidProxyInstallResult> {
  const unavailable = droidProxyInstallUnavailable();
  if (unavailable) {
    return {
      ok: false,
      message:
        unavailable === 'unsupported-arch'
          ? 'DroidProxy ships Apple Silicon builds only.'
          : 'DroidProxy is a macOS app.',
    };
  }
  if (droidProxyAppPath()) return { ok: true };
  const workdir = await mkdtemp(join(tmpdir(), 'droidex-droidproxy-'));
  try {
    const zipPath = join(workdir, 'DroidProxy-arm64.zip');
    await downloadVerifiedZip(zipPath, onProgress, signal);
    signal?.throwIfAborted();
    onProgress({ phase: 'installing' });
    // ditto, not unzip: only it preserves the bundle's code signature.
    const extracted = join(workdir, 'extracted');
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', zipPath, extracted], {
      timeout: DITTO_TIMEOUT_MS,
    });
    const stagedApp = join(extracted, 'DroidProxy.app');
    if (!droidProxyBundleComplete(stagedApp)) {
      throw new Error('Release archive is not a DroidProxy app.');
    }
    const target = await installTarget();
    if (!target) throw new Error('No writable Applications folder found.');
    if (existsSync(target)) return { ok: true };
    const pending = `${target}.droidex-${randomUUID()}.pending`;
    try {
      await execFileAsync('/usr/bin/ditto', [stagedApp, pending], { timeout: DITTO_TIMEOUT_MS });
      // Node downloads are not quarantined automatically. Leave the trust
      // decision to macOS and the user before this app is launched.
      const downloadedAt = Math.floor(Date.now() / 1000).toString(16);
      try {
        await execFileAsync(
          '/usr/bin/xattr',
          ['-w', 'com.apple.quarantine', `0083;${downloadedAt};DROIDEX;`, pending],
          { timeout: DITTO_TIMEOUT_MS },
        );
      } catch {
        throw new Error('Could not mark DroidProxy for macOS verification. Install it manually.');
      }
      if (existsSync(target)) throw new Error('DroidProxy was installed by another process.');
      await rename(pending, target);
    } finally {
      await rm(pending, { recursive: true, force: true });
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return signal?.aborted === true
        ? { ok: false, cancelled: true, message: 'Install cancelled.' }
        : { ok: false, message: 'Download timed out.' };
    }
    return { ok: false, message: error instanceof Error ? error.message : 'Install failed.' };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

// Downloads the release zip with progress, then checks it against the
// release's sha256 file. The checksum guards a corrupt or truncated
// download, not endpoint compromise: it ships beside the zip over the same
// TLS connection.
async function downloadVerifiedZip(
  zipPath: string,
  onProgress: (progress: DroidProxyInstallProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  onProgress({ phase: 'downloading', receivedBytes: 0 });
  await downloadFile(
    DROIDPROXY_ZIP_URL,
    zipPath,
    (receivedBytes, totalBytes) => {
      onProgress({
        phase: 'downloading',
        receivedBytes,
        ...(totalBytes === undefined ? {} : { totalBytes }),
      });
    },
    combined,
  );
  onProgress({ phase: 'verifying' });
  const shaResponse = await fetch(DROIDPROXY_SHA_URL, { signal: combined });
  if (!shaResponse.ok) {
    throw new Error(`Checksum download failed (HTTP ${String(shaResponse.status)}).`);
  }
  const expected = parseSha256File(await shaResponse.text());
  if (!expected) throw new Error('Release checksum is missing or malformed.');
  if ((await sha256FileHex(zipPath)) !== expected) {
    throw new Error('Download failed verification. Try again or use manual download.');
  }
  combined.throwIfAborted();
}
