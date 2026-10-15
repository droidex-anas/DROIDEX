import type { IncomingMessage, ServerResponse } from 'node:http';
import { remoteUsageSnapshot } from '../../../packages/remote/src/usage.js';

const MAX_RESPONSE_BYTES = 256 * 1024;

export function serveProfileUsage(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  snapshot: (() => unknown) | undefined,
): boolean {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/profile/usage') return false;
  if (request.method !== 'GET') {
    response.writeHead(405).end('method not allowed');
    return true;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end('unauthorized');
    return true;
  }
  if (!snapshot) {
    response.writeHead(503).end('usage unavailable');
    return true;
  }
  void Promise.resolve()
    .then(snapshot)
    .then((value) => {
      const body = JSON.stringify(remoteUsageSnapshot(value));
      if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
        throw new Error('Usage snapshot exceeded its response limit.');
      }
      response.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'",
      });
      response.end(body);
    })
    .catch(() => {
      if (!response.headersSent) response.writeHead(503);
      response.end('usage unavailable');
    });
  return true;
}
