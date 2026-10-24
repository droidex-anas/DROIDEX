import type { ChildIdentity } from './ChildSessionState.js';
import type { ChildFileHistorySource } from './ChildSessionsTypes.js';
import type { ClientCommand } from './protocol.js';
import type { SessionFileChange } from './sessionFileCache.js';

type WatchCommand = Extract<ClientCommand, { type: 'child.watchHistory' }>;

interface Selection {
  owner: object;
  requestId: string;
  identity: ChildIdentity;
  source?: ChildFileHistorySource;
  limit?: number;
  dirty: boolean;
  reading: boolean;
}

interface Dependencies {
  fileHistorySource(identity: ChildIdentity, limit?: number): ChildFileHistorySource | undefined;
  whenHistoryReady(): Promise<void>;
  reportError(identity: ChildIdentity, error: unknown): void;
}

// Droid's autonomous Task process writes its own transcript. The selected pane
// observes that file; opening another SDK process would not subscribe to it.
export class ChildHistoryWatch {
  private selected?: Selection;

  constructor(private readonly dependencies: Dependencies) {}

  set(owner: object, command: WatchCommand): void {
    if (!command.target) {
      if (this.selected?.owner === owner && this.selected.requestId === command.requestId)
        this.selected = undefined;
      return;
    }
    const { parentAppSessionId, childSessionId, limit } = command.target;
    const identity = { parentAppSessionId, childSessionId };
    const selected = {
      owner,
      requestId: command.requestId,
      identity,
      ...(limit === undefined ? {} : { limit }),
      dirty: true,
      reading: false,
    };
    this.selected = selected;
    this.bindSource(selected);
  }

  clearOwner(owner: object): void {
    if (this.selected?.owner === owner) this.selected = undefined;
  }

  clearParent(parentAppSessionId: string): void {
    if (this.selected?.identity.parentAppSessionId === parentAppSessionId)
      this.selected = undefined;
  }

  // Retirement and restarts close the runtime under an open pane, which never
  // re-sends its watch; the reopened parent rebinds the kept selection.
  parentClosing(parentAppSessionId: string): void {
    const selected = this.selected;
    if (selected?.identity.parentAppSessionId !== parentAppSessionId) return;
    this.selected = {
      owner: selected.owner,
      requestId: selected.requestId,
      identity: selected.identity,
      ...(selected.limit === undefined ? {} : { limit: selected.limit }),
      dirty: true,
      reading: false,
    };
  }

  close(): void {
    this.selected = undefined;
  }

  parentAttached(parentAppSessionId: string): void {
    const selected = this.selected;
    if (selected?.identity.parentAppSessionId !== parentAppSessionId) return;
    if (!selected.source) this.bindSource(selected);
    else if (!selected.source.isCurrent()) this.selected = undefined;
  }

  filesReconciled(changes: readonly SessionFileChange[] | null): void {
    const selected = this.selected;
    if (!selected) return;
    const source = selected.source;
    if (!source) {
      this.bindSource(selected);
      return;
    }
    if (!source.isCurrent()) {
      this.selected = undefined;
      return;
    }
    if (
      changes &&
      !changes.some(({ providerSessionId }) => source.containsProvider(providerSessionId))
    )
      return;
    selected.dirty = true;
    this.read(selected);
  }

  private isCurrent(selected: Selection): boolean {
    return this.selected === selected && selected.source?.isCurrent() === true;
  }

  private bindSource(selected: Selection): void {
    const source = this.dependencies.fileHistorySource(selected.identity, selected.limit);
    if (!source || this.selected !== selected) return;
    const bound = { ...selected, source, dirty: true, reading: false };
    this.selected = bound;
    this.read(bound);
  }

  private read(selected: Selection): void {
    if (selected.reading) return;
    selected.reading = true;
    void this.refresh(selected).finally(() => {
      selected.reading = false;
      if (selected.dirty && this.isCurrent(selected)) this.read(selected);
    });
  }

  private async refresh(selected: Selection): Promise<void> {
    const source = selected.source;
    if (!source) return;
    try {
      while (selected.dirty && this.isCurrent(selected)) {
        await this.dependencies.whenHistoryReady();
        if (!this.isCurrent(selected)) return;
        // Changes received while waiting for the path index are included by
        // this read. Only changes during the read require another pass.
        selected.dirty = false;
        await source.refresh(() => this.isCurrent(selected));
      }
    } catch (error) {
      selected.dirty = false;
      if (this.isCurrent(selected)) this.dependencies.reportError(selected.identity, error);
    }
  }
}
