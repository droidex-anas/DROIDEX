import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { createRelayHub, MAX_FRAME_BYTES } from './hub.mjs';

export function createRelayServer({ allowedOrigins = [] } = {}) {
  const origins = new Set(allowedOrigins);
  const hub = createRelayHub();
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    } else response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    const origin = request.headers.origin;
    if (request.url !== '/relay' || (origin && !origins.has(origin))) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    sockets.handleUpgrade(request, socket, head, (client) => hub.attach(client));
  });
  return {
    server,
    close: () => new Promise((resolve) => {
      hub.close();
      sockets.close(() => server.close(resolve));
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const relay = createRelayServer({
    allowedOrigins: (process.env.REMOTE_ALLOWED_ORIGINS ?? 'https://droidex.vercel.app').split(',').map((origin) => origin.trim()).filter(Boolean),
  });
  relay.server.listen(port, process.env.HOST ?? '127.0.0.1', () => {
    console.log(`DROIDEX relay listening on port ${port}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void relay.close(); });
}
