import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { ClientCommand, ServerEvent } from '../protocol.js';
import { authorize, digest, failure, json, readJSON } from './http.js';
import { RemoteServer } from './server.js';
import { RemoteSessionIndex } from './sessionIndex.js';
import { RemoteError, record, text, type RemoteRuntime } from './types.js';

export function localAddresses(): string[] {
  const addresses = new Set<string>();
  for (const values of Object.values(networkInterfaces())) for (const value of values || []) {
    if (value.family !== 'IPv4' || value.internal) continue;
    const bytes = value.address.split('.').map(Number);
    if (bytes[0] === 10 || (bytes[0] === 192 && bytes[1] === 168) || (bytes[0] === 172 && bytes[1]! >= 16 && bytes[1]! <= 31)) addresses.add(value.address);
  }
  return [...addresses, '127.0.0.1'];
}

export async function startRemoteAdmin(dataDirectory: string, runtime: RemoteRuntime, index = new RemoteSessionIndex()) {
  const capabilityPath = join(dataDirectory, 'mobile-control.json');
  const token = randomBytes(32).toString('hex');
  const tokenHash = digest(`Bearer ${token}`);
  let remote: RemoteServer | undefined;
  let enabling = false;
  let closed = false;
  const retired = new Set<RemoteServer>();
  const admin = createServer((request, response) => {
    void (async () => {
      authorize(request, tokenHash);
      const route = `${request.method} ${request.url}`;
      if (route === 'GET /status') {
        json(response, 200, { ...(remote?.status() || { enabled: false }), addresses: localAddresses(), enabling });
      } else if (route === 'POST /enable') {
        if (closed || enabling || remote) throw new RemoteError(409, 'Stop sharing before selecting a different project.');
        enabling = true;
        try {
          const body = record(await readJSON(request));
          const address = text(body.address, 'Network address', 64);
          if (!localAddresses().includes(address)) throw new RemoteError(400, 'Choose a local network interface.');
          const workspace = await realpath(text(body.workspace, 'Workspace path', 4_096));
          if (!(await stat(workspace)).isDirectory()) throw new RemoteError(400, 'Choose a project folder.');
          if (closed) throw new RemoteError(410, 'Setup was cancelled.');
          const candidate = new RemoteServer(workspace, runtime, undefined, index);
          remote = candidate;
          try {
            await candidate.start(address);
            if (closed || remote !== candidate) throw new RemoteError(410, 'Setup was cancelled.');
            json(response, 200, candidate.status());
          } catch (error) {
            if (remote === candidate) remote = undefined;
            if (candidate.host.hasPendingCreates) retired.add(candidate);
            await candidate.close();
            throw error;
          }
        } finally { enabling = false; }
      } else if (route === 'POST /approve') {
        const body = record(await readJSON(request));
        if (!remote || typeof body.allow !== 'boolean') throw new RemoteError(409, 'No pairing is waiting.');
        remote.approve(text(body.id, 'Request ID', 36), body.allow);
        json(response, 200, remote.status());
      } else if (route === 'POST /renew') {
        if (!remote) throw new RemoteError(409, 'Share a project before generating a QR.');
        remote.renewPairing();
        json(response, 200, remote.status());
      } else if (route === 'POST /disable') {
        const previous = remote;
        remote = undefined;
        if (previous) {
          if (previous.host.hasPendingCreates) retired.add(previous);
          await previous.close();
        }
        json(response, 200, { enabled: false });
      } else throw new RemoteError(404, 'Unknown remote control operation.');
    })().catch((error: unknown) => failure(response, error));
  });
  admin.requestTimeout = 20_000;
  admin.headersTimeout = 10_000;
  admin.maxConnections = 8;
  await new Promise<void>((resolve, reject) => {
    admin.once('error', reject);
    admin.listen(0, '127.0.0.1', resolve);
  });
  const address = admin.address();
  if (!address || typeof address === 'string') throw new Error('Could not start remote administration.');
  await mkdir(dataDirectory, { recursive: true });
  const temporary = capabilityPath + `.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ port: address.port, token }), { mode: 0o600 });
    await rename(temporary, capabilityPath);
  } catch (error) { admin.close(); await rm(temporary, { force: true }); throw error; }
  return {
    observe(event: ServerEvent) {
      remote?.observe(event);
      for (const previous of retired) {
        previous.observe(event);
        if (!previous.host.hasPendingCreates) retired.delete(previous);
      }
    },
    commandReceived(command: ClientCommand) { remote?.commandReceived(command); },
    commandCompleted(command: ClientCommand) { remote?.commandCompleted(command); },
    async close() {
      closed = true;
      const previous = remote;
      remote = undefined;
      const results = await Promise.allSettled([
        ...(previous ? [previous.close()] : []),
        ...[...retired].map((server) => server.close()),
      ]);
      retired.clear();
      await new Promise<void>((resolve) => { admin.close(() => resolve()); admin.closeAllConnections(); });
      try {
        const current = JSON.parse(await readFile(capabilityPath, 'utf8')) as { token?: string };
        if (current.token === token) await rm(capabilityPath, { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Could not remove the remote control capability file.');
      }
      const rejected = results.find((result) => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
    },
  };
}
