import type { ChildIdentity } from './ChildSessionState.js';
import type { ChildFileHistorySource } from './ChildSessionsTypes.js';
import type { ClientCommand } from './protocol.js';
import type { SessionFileChange } from './sessionFileCache.js';

type WatchCommand = Extract<ClientCommand, { type: 'child.watchHistory' }>;

// One write burst (FSEvents reports several events per append) becomes one read.
const WRITE_SETTLE_MS = 100;

interface Selection {
  owner: object;
  requestId: string;
  identity: ChildIdentity;
  source?: ChildFileHistorySource;
  limit?: number;
  dirty: boolean;
  reading: boolean;
  writeTimer?: NodeJS.Timeout;
}

interface Dependencies {
  fileHistorySource(identity: ChildIdentity, limit?: number): ChildFileHistorySource | undefined;
  whenHistoryReady(): Promise<void>;
  reportError(identity: ChildIdentity, error: unknown): void;
}

function unboundSelection(selection: Selection): Selection {
  return {
    owner: selection.owner,
    requestId: selection.requestId,
    identity: selection.identity,
    ...(selection.limit === undefined ? {} : { limit: selection.limit }),
    dirty: true,
    reading: false,
  };
}

// Droid's autonomous Task process writes its own transcript. The selected pane
// observes that file; opening another SDK process would not subscribe to it.
// Each connection owns one selection, so two windows can watch different agents.
export class ChildHistoryWatch {
  private readonly selections = new Map<object, Selection>();

  constructor(private readonly dependencies: Dependencies) {}

  set(owner: object, command: WatchCommand): void {
    if (!command.target) {
      if (this.selections.get(owner)?.requestId === command.requestId) this.remove(owner);
      return;
    }
    const { parentAppSessionId, childSessionId, limit } = command.target;
    const selection: Selection = {
      owner,
      requestId: command.requestId,
      identity: { parentAppSessionId, childSessionId },
      ...(limit === undefined ? {} : { limit }),
      dirty: true,
      reading: false,
    };
    this.replace(selection);
    this.bindSource(selection);
  }

  clearOwner(owner: object): void {
    this.remove(owner);
  }

  clearParent(parentAppSessionId: string): void {
    for (const selection of this.selectionsOf(parentAppSessionId)) this.remove(selection.owner);
  }

  // Retirement and restarts close the runtime under an open pane, which never
  // re-sends its watch; the reopened parent rebinds the kept selection.
  parentClosing(parentAppSessionId: string): void {
    for (const selection of this.selectionsOf(parentAppSessionId))
      this.replace(unboundSelection(selection));
  }

  close(): void {
    for (const owner of [...this.selections.keys()]) this.remove(owner);
  }

  parentAttached(parentAppSessionId: string): void {
    for (const selection of this.selectionsOf(parentAppSessionId)) {
      if (!selection.source) this.bindSource(selection);
      else if (!selection.source.isCurrent()) this.remove(selection.owner);
    }
  }

  filesReconciled(changes: readonly SessionFileChange[] | null): void {
    for (const selection of [...this.selections.values()]) {
      const source = selection.source;
      if (!source) {
        this.bindSource(selection);
        continue;
      }
      if (!source.isCurrent()) {
        this.remove(selection.owner);
        continue;
      }
      if (
        changes &&
        !changes.some(({ providerSessionId }) => source.containsProvider(providerSessionId))
      )
        continue;
      selection.dirty = true;
      this.read(selection);
    }
  }

  // The list reconcile batches writes for over a second; an open pane reads its
  // own agent's file as soon as a write settles.
  fileWritten(providerSessionId: string): void {
    for (const selection of this.selections.values()) {
      if (selection.writeTimer || !selection.source?.containsProvider(providerSessionId)) continue;
      selection.writeTimer = setTimeout(() => {
        selection.writeTimer = undefined;
        if (!this.isCurrent(selection)) return;
        selection.dirty = true;
        this.read(selection);
      }, WRITE_SETTLE_MS);
    }
  }

  private replace(selection: Selection): void {
    clearTimeout(this.selections.get(selection.owner)?.writeTimer);
    this.selections.set(selection.owner, selection);
  }

  private remove(owner: object): void {
    clearTimeout(this.selections.get(owner)?.writeTimer);
    this.selections.delete(owner);
  }

  private selectionsOf(parentAppSessionId: string): Selection[] {
    return [...this.selections.values()].filter(
      (selection) => selection.identity.parentAppSessionId === parentAppSessionId,
    );
  }

  private isCurrent(selection: Selection): boolean {
    return (
      this.selections.get(selection.owner) === selection && selection.source?.isCurrent() === true
    );
  }

  private bindSource(selection: Selection): void {
    const source = this.dependencies.fileHistorySource(selection.identity, selection.limit);
    if (!source || this.selections.get(selection.owner) !== selection) return;
    const bound = { ...selection, source, dirty: true, reading: false };
    this.replace(bound);
    this.read(bound);
  }

  private read(selection: Selection): void {
    if (selection.reading) return;
    selection.reading = true;
    void this.refresh(selection).finally(() => {
      selection.reading = false;
      if (selection.dirty && this.isCurrent(selection)) this.read(selection);
    });
  }

  private async refresh(selection: Selection): Promise<void> {
    const source = selection.source;
    if (!source) return;
    try {
      while (selection.dirty && this.isCurrent(selection)) {
        await this.dependencies.whenHistoryReady();
        if (!this.isCurrent(selection)) return;
        // Changes received while waiting for the path index are included by
        // this read. Only changes during the read require another pass.
        selection.dirty = false;
        await source.refresh(() => this.isCurrent(selection));
      }
    } catch (error) {
      selection.dirty = false;
      if (this.isCurrent(selection)) this.dependencies.reportError(selection.identity, error);
    }
  }
}
