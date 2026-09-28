// The renderer page owns the WebRTC peer. A disconnected page can reclaim its
// call after a transport reconnect, but a reloaded page cannot use that peer.

// The bridge retries for up to five seconds; allow one retry and handshake.
const VOICE_RECONNECT_GRACE_MS = 10_000;
// The renderer gives up on an unanswered start after 20 s; past this, a start
// still open is abandoned and no longer holds back an orphan stop.
const VOICE_START_LIMIT_MS = 30_000;

interface VoiceOwner {
  pageId: string;
  stopTimer?: NodeJS.Timeout;
}

/** The newest start on a chat. Only it can take the call; older ones were replaced. */
interface VoiceOpening {
  pageId: string;
  attempt: string;
  since: number;
}

export class VoiceConnectionOwners {
  /** Each page's open connection. A call belongs to a page, not to a socket. */
  private readonly pages = new Map<string, object>();
  private readonly owners = new Map<string, VoiceOwner>();
  private readonly openings = new Map<string, VoiceOpening>();

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

  startBegan(appSessionId: string, pageId: string, attempt: string): void {
    this.openings.set(appSessionId, { pageId, attempt, since: Date.now() });
  }

  /** Gives the call to the page whose start this was, unless a newer start replaced it. */
  startSucceeded(appSessionId: string, attempt: string): void {
    const opening = this.openings.get(appSessionId);
    if (opening?.attempt !== attempt) return;
    this.openings.delete(appSessionId);
    this.stopped(appSessionId);
    const owner: VoiceOwner = { pageId: opening.pageId };
    this.owners.set(appSessionId, owner);
    // The page may have dropped while its call was opening.
    if (!this.pages.has(opening.pageId)) this.armStop(appSessionId, owner);
  }

  startFailed(appSessionId: string, attempt: string): void {
    if (this.openings.get(appSessionId)?.attempt === attempt) this.openings.delete(appSessionId);
  }

  stopped(appSessionId: string, pageId?: string): boolean {
    const owner = this.owners.get(appSessionId);
    if (owner && pageId !== undefined && owner.pageId !== pageId) return false;
    if (owner) this.cancelStop(owner);
    this.owners.delete(appSessionId);
    if (pageId !== undefined && this.openings.get(appSessionId)?.pageId === pageId)
      this.openings.delete(appSessionId);
    return true;
  }

  close(): void {
    for (const owner of this.owners.values()) this.cancelStop(owner);
    this.owners.clear();
    this.pages.clear();
    this.openings.clear();
  }

  private armStop(appSessionId: string, owner: VoiceOwner): void {
    if (owner.stopTimer) return;
    owner.stopTimer = setTimeout(() => {
      owner.stopTimer = undefined;
      // A newer call opening on this chat replaces this one when it succeeds;
      // stopping now would end that call instead. Wait for it to settle.
      if (this.isOpening(appSessionId)) {
        this.armStop(appSessionId, owner);
        return;
      }
      if (this.owners.get(appSessionId) !== owner) return;
      this.owners.delete(appSessionId);
      this.stopOrphan(appSessionId);
    }, VOICE_RECONNECT_GRACE_MS);
    owner.stopTimer.unref();
  }

  private isOpening(appSessionId: string): boolean {
    const opening = this.openings.get(appSessionId);
    return opening !== undefined && Date.now() - opening.since < VOICE_START_LIMIT_MS;
  }

  private cancelStop(owner: VoiceOwner): void {
    if (owner.stopTimer) clearTimeout(owner.stopTimer);
    owner.stopTimer = undefined;
  }
}
