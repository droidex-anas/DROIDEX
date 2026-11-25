import { factoryReasoningEffort } from './DroidRuntime.js';
import {
  childAcceptsWork,
  childIdentity,
  parentDroidSession,
  type ChildIdentity,
  type ChildSessionState,
  type ParentChildSessions,
} from './ChildSessionState.js';
import type {
  ChildSessionsDependencies,
  ChildSettingsCommand,
  ChildSettingsTarget,
} from './ChildSessionsTypes.js';
import type { ChildAutomaticCompactionTarget, ChildCompactionTarget } from './SessionCompaction.js';
import { errMsg } from './errors.js';

interface ChildSettingsOperations {
  isCurrentChild(parent: ParentChildSessions, child: ChildSessionState): boolean;
  resolveDefaultSettings: ChildSessionsDependencies['resolveDefaultSettings'];
  commit(child: ChildSessionState): boolean;
  emitError(identity: ChildIdentity, code: string, message: string): void;
  automaticTarget(
    parent: ParentChildSessions,
    child: ChildSessionState,
  ): ChildAutomaticCompactionTarget;
  compactionTarget(
    parent: ParentChildSessions,
    child: ChildSessionState,
    modelId: string,
  ): ChildCompactionTarget;
  compaction: Pick<ChildSessionsDependencies['compaction'], 'cancel' | 'rearmModelChangedChild'>;
}

const ignoreError = (): undefined => undefined;

export class ChildSettingsTransactions {
  constructor(private readonly operations: ChildSettingsOperations) {}

  async updateSettings(
    command: ChildSettingsCommand,
    parent: ParentChildSessions | undefined,
    child: ChildSessionState | undefined,
  ): Promise<void> {
    if (!parent || !child || !Object.hasOwn(command, 'modelId') || !this.isTarget(parent, child)) {
      this.operations.emitError(
        childIdentity(command.parentAppSessionId, command.childSessionId),
        'child.settings_target_invalid',
        `Child session ${command.childSessionId || '(missing)'} is not an active settings target for ${command.parentAppSessionId || '(missing)'}.`,
      );
      return;
    }
    const runtime = child.runtime;
    if (!runtime) return;
    const target = {
      parent,
      child,
      runtime,
      parentGeneration: parent.generation,
      runtimeGeneration: runtime.generation,
    };
    const update = (child.mutationTail ?? Promise.resolve())
      .catch(ignoreError)
      .then(() => this.performSettingsUpdate(target, command));
    child.mutationTail = update;
    try {
      await update;
    } finally {
      if (child.mutationTail === update) delete child.mutationTail;
    }
  }

  isTarget(parent: ParentChildSessions, child: ChildSessionState): boolean {
    return (
      this.operations.isCurrentChild(parent, child) &&
      child.runtime !== undefined &&
      childAcceptsWork(child)
    );
  }

  private isTransaction(target: ChildSettingsTarget): boolean {
    const { parent, child, runtime } = target;
    return (
      parent.generation === target.parentGeneration &&
      runtime.generation === target.runtimeGeneration &&
      this.isTarget(parent, child) &&
      child.runtime === runtime &&
      (target.configurationGeneration === undefined ||
        child.configurationGeneration === target.configurationGeneration)
    );
  }

  private async performSettingsUpdate(
    target: ChildSettingsTarget,
    command: ChildSettingsCommand,
  ): Promise<void> {
    if (!this.isTransaction(target)) return;
    const { parent, child, runtime } = target;
    target.configurationGeneration = child.configurationGeneration;
    let modelId = command.modelId ?? undefined;
    try {
      if (command.modelId === null)
        modelId = this.operations.resolveDefaultSettings(
          parent.lease.summary,
          parentDroidSession(parent.lease).initResult,
          child.role,
        ).modelId;
      if (!modelId) throw new Error(`No Factory default is available for ${child.role}.`);
      if (!this.isTransaction(target)) return;
      await runtime.session.updateSettings({
        modelId,
        ...(command.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: factoryReasoningEffort(command.reasoningEffort) }),
      });
    } catch (error) {
      if (this.isTransaction(target))
        this.operations.emitError(
          child.identity,
          'child.settings_update_failed',
          `Could not update child settings: ${errMsg(error)}`,
        );
      return;
    }
    if (!this.isTransaction(target)) return;
    if (child.turn.autoCompacting)
      this.operations.compaction.cancel(this.operations.automaticTarget(parent, child));
    child.modelId = modelId;
    if (command.reasoningEffort !== undefined) child.reasoningEffort = command.reasoningEffort;
    child.configurationGeneration += 1;
    this.operations.commit(child);
    try {
      await this.operations.compaction.rearmModelChangedChild(
        this.operations.compactionTarget(parent, child, modelId),
        modelId,
      );
    } catch (error) {
      console.error(
        `[compaction] could not resolve exact-child limit for ${runtime.session.sessionId}: ${errMsg(error)}`,
      );
    }
  }
}
