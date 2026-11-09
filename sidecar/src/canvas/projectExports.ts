// Exports into a chat's project folder. The chat owns them outside any turn:
// closing it for good aborts each at once, before any of its cleanup awaits,
// so none publishes into a project its chat has let go of.

export interface ProjectExportAdmission {
  projectFolder: string;
  /** Aborts when the chat closes for good or the app shuts down. */
  signal: AbortSignal;
  /** Releases this admission; safe to call more than once. */
  settle: () => void;
}

export class ProjectExports {
  // Replaced, not reused, when a chat closes, so a late settle reaches only its own era.
  private readonly running = new Map<string, Set<AbortController>>();

  admit(appSessionId: string, projectFolder: string): ProjectExportAdmission {
    let chat = this.running.get(appSessionId);
    if (!chat) {
      chat = new Set();
      this.running.set(appSessionId, chat);
    }
    const era = chat;
    const controller = new AbortController();
    era.add(controller);
    return {
      projectFolder,
      signal: controller.signal,
      settle: () => {
        era.delete(controller);
        if (era.size === 0 && this.running.get(appSessionId) === era)
          this.running.delete(appSessionId);
      },
    };
  }

  endSession(appSessionId: string): void {
    const chat = this.running.get(appSessionId);
    this.running.delete(appSessionId);
    for (const controller of chat ?? []) controller.abort();
  }

  endAll(): void {
    for (const appSessionId of [...this.running.keys()]) this.endSession(appSessionId);
  }
}
