// The renderer page owns the WebRTC peer. A disconnected page can reclaim its
// call after a transport reconnect, but a reloaded page cannot use that peer.

// The bridge retries for up to five seconds; allow one retry and handshake.
const VOICE_RECONNECT_GRACE_MS = 10_000;

interface VoiceOwner {
  pageId: string;
  stopTimer?: NodeJS.Timeout;
}

export class VoiceConnectionOwners {
  /** Each page's open connection. A call belongs to a page, not to a socket. */
  private readonly pages = new Map<string, object>();
  private readonly owners = new Map<string, VoiceOwner>();
  /** Chats with a voice start still running; their orphan stop waits for it. */
  private readonly starting = new Set<string>();

  constructor(private readonly stopOrphan: (appSessionId: string) => void) {}

  connected(pageId: string, connection: object): void {
    this.pages.set(pageId, connection);
    for (const owner of this.owners.values()) {
      if (owner.pageId === pageId) this.cancelStop(owner);
    }
  }

  disconnected(connection: object): void {
    for (const [pageId, open] of this.pages) {
      if (open !== connection) continue;
      this.pages.delete(pageId);
      for (const [appSessionId, owner] of this.owners) {
        if (owner.pageId === pageId) this.armStop(appSessionId, owner);
      }
    }
  }

  startBegan(appSessionId: string): void {
    this.starting.add(appSessionId);
  }

  startEnded(appSessionId: string): void {
    this.starting.delete(appSessionId);
  }

  started(appSessionId: string, pageId: string): void {
    this.stopped(appSessionId);
    const owner: VoiceOwner = { pageId };
    this.owners.set(appSessionId, owner);
    // The page may have dropped while its call was opening.
    if (!this.pages.has(pageId)) this.armStop(appSessionId, owner);
  }

  stopped(appSessionId: string, pageId?: string): boolean {
    const owner = this.owners.get(appSessionId);
    if (owner && pageId !== undefined && owner.pageId !== pageId) return false;
    if (owner) this.cancelStop(owner);
    this.owners.delete(appSessionId);
    return true;
  }

  close(): void {
    for (const owner of this.owners.values()) this.cancelStop(owner);
    this.owners.clear();
    this.pages.clear();
    this.starting.clear();
  }

  private armStop(appSessionId: string, owner: VoiceOwner): void {
    if (owner.stopTimer) return;
    owner.stopTimer = setTimeout(() => {
      owner.stopTimer = undefined;
      // A new call opening on this chat replaces this one when it succeeds;
      // stopping now would end that call instead. Wait for it to settle.
      if (this.starting.has(appSessionId)) {
        this.armStop(appSessionId, owner);
        return;
      }
      if (this.owners.get(appSessionId) !== owner) return;
      this.owners.delete(appSessionId);
      this.stopOrphan(appSessionId);
    }, VOICE_RECONNECT_GRACE_MS);
    owner.stopTimer.unref();
  }

  private cancelStop(owner: VoiceOwner): void {
    if (owner.stopTimer) clearTimeout(owner.stopTimer);
    owner.stopTimer = undefined;
  }
}
