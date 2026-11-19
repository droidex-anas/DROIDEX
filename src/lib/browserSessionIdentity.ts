import type { SessionSummary } from '@droidex/protocol';

export function browserKeyForSession(session: SessionSummary | undefined): string | undefined {
  if (!session) return undefined;
  // The backend keys browser sessions by the stable app session id, which never
  // changes (compaction swaps providerSessionId, but the browser key must not).
  return session.appSessionId;
}
