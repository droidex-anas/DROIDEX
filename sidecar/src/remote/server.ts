import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import type { ServerResponse } from 'node:http';
import { hostname } from 'node:os';
import { basename } from 'node:path';
import type { ClientCommand, ServerEvent } from '../protocol.js';
import { createRemoteCertificate } from './certificate.js';
import { RemoteHost } from './host.js';
import { RemoteReview } from './review.js';
import { RemoteSessionIndex } from './sessionIndex.js';
import { authorize, digest, failure, json, matches, readJSON } from './http.js';
import { listWorkspaceFiles, readWorkspaceFile } from './workspaceFiles.js';
import { RemoteError, record, text, type RemoteEvent, type RemoteRuntime, type RemoteSync } from './types.js';

interface PendingPair { id: string; name: string; finish(allow: boolean): void }

export class RemoteServer {
  readonly id = randomUUID();
  readonly name = hostname();
  readonly host: RemoteHost;
  private readonly review: RemoteReview;
  private server?: Server;
  private address = '';
  private fingerprint = '';
  private ticket = randomBytes(32).toString('hex');
  private ticketExpiresAt = Date.now() + 180_000;
  private usedTicket = false;
  private attempts = 0;
  private tokenHash?: Buffer;
  private device?: { id: string; name: string };
  private pending?: PendingPair;
  private closed = false;
  private closing?: Promise<void>;
  private streams = new Set<ServerResponse>();
  private dirty = new Map<string, RemoteEvent>();
  private flushTimer?: NodeJS.Timeout;
  private lastSeenAt?: number;
  private catalogRefresh?: Promise<void>;
  private catalogError?: string;

  constructor(readonly workspace: string, runtime: RemoteRuntime,
    private readonly certificateFactory = createRemoteCertificate, index = new RemoteSessionIndex()) {
    this.review = new RemoteReview(workspace);
    this.host = new RemoteHost(workspace, runtime, (event) => this.enqueue(event), undefined, index);
  }

  async start(bindAddress: string): Promise<void> {
    const certificate = await this.certificateFactory(bindAddress);
    if (this.closed) throw new RemoteError(410, 'Connection setup was cancelled.');
    this.fingerprint = certificate.fingerprint;
    this.server = createServer({ key: certificate.key, cert: certificate.cert, minVersion: 'TLSv1.2', maxHeaderSize: 8_192 }, (request, response) => {
      void (async () => {
        if (this.closed || request.headers.origin) throw new RemoteError(403, 'Connection is unavailable.');
        const url = new URL(request.url || '/', 'https://localhost');
        const route = `${request.method} ${url.pathname}`;
        if (route === 'POST /pair/check') {
          const body = record(await readJSON(request));
          this.checkTicket(body.ticket);
          json(response, 200, { computerName: this.name });
          return;
        }
        if (route === 'POST /pair') {
          const body = record(await readJSON(request));
          this.checkTicket(body.ticket);
          const name = text(body.name, 'Device name', 80);
          this.usedTicket = true;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => finish(false), 90_000);
            const finish = (allow: boolean) => {
              clearTimeout(timer);
              response.off('close', disconnected);
              this.pending = undefined;
              if (!response.destroyed) {
                if (allow && !this.closed) {
                  const token = randomBytes(32).toString('hex');
                  this.tokenHash = digest(`Bearer ${token}`);
                  this.device = { id: randomUUID(), name };
                  json(response, 200, { token, computerId: this.id, computerName: this.name, workspace: basename(this.workspace) });
                } else json(response, 403, { error: 'Pairing was declined, cancelled, or timed out. Choose New code on the computer.' });
              }
              resolve();
            };
            const disconnected = () => finish(false);
            this.pending = { id: randomUUID(), name, finish };
            response.once('close', disconnected);
          });
          return;
        }
        authorize(request, this.tokenHash);
        this.lastSeenAt = Date.now();
        if (route === 'GET /bootstrap') {
          // Paint the connection before history or provider discovery finishes.
          json(response, 200, { version: 3, computerId: this.id, computerName: this.name,
            workspace: basename(this.workspace), models: this.host.models, sessions: this.host.snapshot(), sync: this.syncState() });
          this.refresh();
        } else if (route === 'GET /events') {
          this.openStream(response);
        } else if (route === 'POST /refresh') {
          this.refresh();
          json(response, 202, { accepted: true });
        } else if (route === 'GET /files') {
          json(response, 200, await listWorkspaceFiles(this.workspace, url.searchParams.get('path') || '', url.searchParams.get('cursor') || '0'));
        } else if (route === 'GET /file') {
          json(response, 200, await readWorkspaceFile(this.workspace, url.searchParams.get('path') || ''));
        } else if (route === 'GET /changes') {
          json(response, 200, await this.review.changes());
        } else if (route === 'GET /pull-requests') {
          json(response, 200, await this.review.pullRequests());
        } else if (request.method === 'GET' && /^\/pull-requests\/\d+$/.test(url.pathname)) {
          json(response, 200, await this.review.pullRequest(Number(url.pathname.split('/').at(-1))));
        } else if (route === 'POST /turn') {
          this.host.turn(await readJSON(request));
          json(response, 202, { accepted: true });
        } else {
          const match = /^\/sessions\/([0-9a-f-]+)\/(stop|approval|answer|remove|history)$/.exec(url.pathname);
          if (request.method !== 'POST' || !match) throw new RemoteError(404, 'Unknown remote operation.');
          const [, id, operation] = match;
          if (operation === 'stop') await this.host.interrupt(id!);
          if (operation === 'approval') await this.host.approve(id!, await readJSON(request));
          if (operation === 'answer') await this.host.answer(id!, await readJSON(request));
          if (operation === 'remove') await this.host.remove(id!);
          if (operation === 'history') await this.host.loadHistory(id!);
          json(response, 200, { accepted: true });
        }
      })().catch((error: unknown) => failure(response, error));
    });
    this.server.requestTimeout = 15_000;
    this.server.headersTimeout = 10_000;
    this.server.maxConnections = 16;
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, bindAddress, resolve);
    });
    const endpoint = this.server.address();
    if (!endpoint || typeof endpoint === 'string') throw new Error('The remote listener did not open.');
    this.address = `https://${bindAddress}:${endpoint.port}`;
    this.refresh();
  }

  observe(event: ServerEvent): void {
    if (event.type === 'catalog.updated' && event.catalog === 'models') this.catalogError = undefined;
    this.host.observe(event);
    if (event.type === 'catalog.updated' && event.catalog === 'models') {
      this.enqueue({ type: 'sync', sync: this.syncState() });
    }
  }
  commandReceived(command: ClientCommand): void { this.host.commandReceived(command); }
  commandCompleted(command: ClientCommand): void { this.host.commandCompleted(command); }

  status() {
    const expired = Date.now() >= this.ticketExpiresAt;
    const code = this.usedTicket || expired || this.closed ? undefined : 'DX1.' + Buffer.from(JSON.stringify({
      version: 1, address: this.address, fingerprint: this.fingerprint, ticket: this.ticket,
    })).toString('base64url');
    return { enabled: !this.closed, computerName: this.name, workspace: this.workspace,
      address: this.address, code, expiresAt: this.ticketExpiresAt, expired,
      pending: this.pending ? { id: this.pending.id, name: this.pending.name } : undefined,
      device: this.device, connected: this.streams.size > 0, lastSeenAt: this.lastSeenAt,
      models: this.host.models.length, sessions: this.host.sessionCount, running: this.host.activeCount, sync: this.syncState() };
  }

  renewPairing(): void {
    if (this.closed || this.device || this.pending) throw new RemoteError(409, 'Disconnect the current phone before pairing a different one.');
    this.ticket = randomBytes(32).toString('hex');
    this.ticketExpiresAt = Date.now() + 180_000;
    this.usedTicket = false;
    this.attempts = 0;
  }

  approve(id: string, allow: boolean): void {
    if (this.pending?.id !== id) throw new RemoteError(409, 'That pairing request is no longer waiting.');
    this.pending.finish(allow);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.tokenHash = undefined;
    this.pending?.finish(false);
    clearTimeout(this.flushTimer);
    this.dirty.clear();
    for (const response of this.streams) response.destroy();
    this.streams.clear();
    const closed = this.server ? new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
      this.server!.closeAllConnections();
    }) : Promise.resolve();
    this.closing = Promise.all([closed, this.host.close()]).then(() => undefined);
    return this.closing;
  }

  private checkTicket(value: unknown): void {
    if (++this.attempts > 20 || this.usedTicket || Date.now() >= this.ticketExpiresAt || !matches(text(value, 'Pairing ticket', 64), digest(this.ticket))) {
      throw new RemoteError(403, 'This code expired or was already used. Choose New code on the computer.');
    }
  }

  private refresh(): void {
    if (this.closed) return;
    void this.host.refreshRecent();
    if (!this.catalogRefresh) this.catalogRefresh = this.host.refreshCatalog().catch(() => {
      if (!this.closed) {
        this.catalogError = 'Models could not load. Check desktop sign-in, then refresh.';
        this.enqueue({ type: 'sync', sync: this.syncState() });
      }
    }).finally(() => { this.catalogRefresh = undefined; });
  }

  private syncState(): RemoteSync {
    return this.catalogError ? { state: 'error', message: this.catalogError } : this.host.sync;
  }

  private enqueue(event: RemoteEvent): void {
    if (this.closed) return;
    if (event.type === 'sync' && this.catalogError) event = { type: 'sync', sync: this.syncState() };
    const key = event.type === 'session' ? event.session.id : event.type === 'removed' ? event.id : event.type;
    this.dirty.set(key, event);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      for (const update of this.dirty.values()) {
        const line = JSON.stringify(update) + '\n';
        for (const response of this.streams) this.write(response, line);
      }
      this.dirty.clear();
    }, 40);
  }

  private openStream(response: ServerResponse): void {
    if (this.streams.size >= 2) throw new RemoteError(429, 'Too many active phone connections.');
    response.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    this.streams.add(response);
    this.write(response, JSON.stringify({ type: 'snapshot', sessions: this.host.snapshot() }) + '\n');
    this.write(response, JSON.stringify({ type: 'catalog', models: this.host.models }) + '\n');
    this.write(response, JSON.stringify({ type: 'sync', sync: this.syncState() }) + '\n');
    const timer = setInterval(() => this.write(response, '{"type":"heartbeat"}\n'), 15_000);
    timer.unref();
    response.once('close', () => { clearInterval(timer); this.streams.delete(response); });
  }

  private write(response: ServerResponse, line: string): void {
    if (response.destroyed || response.writableLength + Buffer.byteLength(line) > 8 * 1024 * 1024) {
      response.destroy(); this.streams.delete(response); return;
    }
    response.write(line);
  }
}
