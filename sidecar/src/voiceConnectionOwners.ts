// The renderer page owns the WebRTC peer. A disconnected page can reclaim its
// call after a transport reconnect, but a reloaded page cannot use that peer.

// The bridge retries for up to five seconds; allow one retry and handshake.
const VOICE_RECONNECT_GRACE_MS = 10_000;

interface VoiceOwner {
  pageId: string;
  connection: object;
  stopTimer?: NodeJS.Timeout;
}

export class VoiceConnectionOwners {
  private readonly owners = new Map<string, VoiceOwner>();

  constructor(private readonly stopOrphan: (appSessionId: string) => void) {}

  started(appSessionId: string, pageId: string, connection: object): void {
    this.stopped(appSessionId);
    this.owners.set(appSessionId, { pageId, connection });
  }

  stopped(appSessionId: string): void {
    const owner = this.owners.get(appSessionId);
    if (owner?.stopTimer) clearTimeout(owner.stopTimer);
    this.owners.delete(appSessionId);
  }

  connected(pageId: string, connection: object): void {
    for (const owner of this.owners.values()) {
      if (owner.pageId !== pageId) continue;
      if (owner.stopTimer) clearTimeout(owner.stopTimer);
      owner.stopTimer = undefined;
      owner.connection = connection;
    }
  }

  disconnected(connection: object): void {
    for (const [appSessionId, owner] of this.owners) {
      if (owner.connection !== connection || owner.stopTimer) continue;
      owner.stopTimer = setTimeout(() => {
        this.owners.delete(appSessionId);
        this.stopOrphan(appSessionId);
      }, VOICE_RECONNECT_GRACE_MS);
      owner.stopTimer.unref();
    }
  }

  close(): void {
    for (const appSessionId of this.owners.keys()) this.stopped(appSessionId);
  }
}
