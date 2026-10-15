import {
  remoteUsageSnapshot,
  type RemoteUsageSnapshot,
} from '../../../packages/remote/src/usage.js';

const MAX_REMOTE_USAGE_BYTES = 40 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export async function readRemoteUsage(
  bridgeInfo: () => Promise<{ port: number; token: string }>,
  request: typeof fetch = fetch,
): Promise<RemoteUsageSnapshot> {
  const bridge = await bridgeInfo();
  let response: Response;
  try {
    response = await request(`http://127.0.0.1:${String(bridge.port)}/profile/usage`, {
      headers: { authorization: `Bearer ${bridge.token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error('Usage is unavailable on your laptop.');
  }
  if (!response.ok) throw new Error('Usage is unavailable on your laptop.');
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_REMOTE_USAGE_BYTES) {
    throw new Error('Usage snapshot is too large to send remotely.');
  }
  try {
    return remoteUsageSnapshot(JSON.parse(body));
  } catch {
    throw new Error('Your laptop returned an invalid usage snapshot.');
  }
}
