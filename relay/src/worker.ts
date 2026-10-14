import { HANDLE_PATTERN } from '../../packages/remote/src/index';
import type { Environment } from './runtime';
export { RelayRoom } from './room';

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = { ...headers, 'Access-Control-Allow-Origin': env.WEB_ORIGIN, Vary: 'Origin' };
    if (origin && origin !== env.WEB_ORIGIN)
      return new Response('{"status":"locked"}', { status: 403, headers });
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }
    const path = /^\/v1\/handles\/([^/]+)\/(socket|challenge|claim)$/.exec(
      new URL(request.url).pathname,
    );
    if (!path || !HANDLE_PATTERN.test(path[1]))
      return new Response('{"status":"locked"}', { status: 404, headers: cors });
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
    if (!(await env.CONNECTION_LIMIT.limit({ key: ip })).success) {
      return new Response('{"status":"locked"}', {
        status: 429,
        headers: { ...cors, 'Retry-After': '60' },
      });
    }
    const room = env.ROOMS.get(env.ROOMS.idFromName(path[1]));
    const response = await room.fetch(request);
    if (response.status === 101) return response;
    const outgoing = new Response(response.body, response);
    for (const [name, value] of Object.entries(cors)) outgoing.headers.set(name, value);
    return outgoing;
  },
};
