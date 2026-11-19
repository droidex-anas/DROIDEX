import type { SessionPrompt } from './SessionLifecycle.js';
import type { SessionSummary } from './protocol.js';
import { userPromptDisplay } from './sessionTranscriptParser.js';

export type SessionCloseMode = 'discard-pending' | 'preserve-pending';
export interface TypedTurn {
  readonly identity: symbol;
}
type TypedOwner =
  | { kind: 'preparing'; turn: TypedTurn }
  | { kind: 'running'; turn: TypedTurn; promise: Promise<void> };
interface DelegatedOwner {
  open: boolean;
  settled: Promise<void>;
}
type Activity =
  | { kind: 'idle' }
  | { kind: 'settling' }
  | { kind: 'typed'; typed: TypedOwner }
  | { kind: 'delegated'; delegated: DelegatedOwner }
  | { kind: 'overlapping'; typed: TypedOwner; delegated: DelegatedOwner };
type Runtime =
  | { kind: 'live'; activity: Activity }
  | { kind: 'closing' | 'closed'; mode: SessionCloseMode; activity: Activity };
type StopRequest = 'none' | 'stop' | 'send-now' | 'both';

export class PrimaryTurnState {
  private runtime: Runtime = { kind: 'live', activity: { kind: 'idle' } };
  private stop: StopRequest = 'none';
  private sends: SessionPrompt[] = [];
  private heldSteers: SessionPrompt[] = [];
  private delegatedGeneration = 0;
  private interrupt: Promise<void> | undefined;

  private get typed(): TypedOwner | undefined {
    const activity = this.runtime.activity;
    return activity.kind === 'typed' || activity.kind === 'overlapping'
      ? activity.typed
      : undefined;
  }

  private get delegated(): DelegatedOwner | undefined {
    const activity = this.runtime.activity;
    return activity.kind === 'delegated' || activity.kind === 'overlapping'
      ? activity.delegated
      : undefined;
  }

  get streaming(): boolean {
    return this.runtime.kind !== 'closed' && this.runtime.activity.kind !== 'idle';
  }
  get turnPromise(): Promise<void> | undefined {
    const typed = this.typed;
    return typed?.kind === 'running' ? typed.promise : undefined;
  }
  get hasTypedTurn(): boolean {
    return this.typed !== undefined;
  }
  get delegatedTurns(): number {
    return this.delegatedGeneration;
  }
  get delegatedTurnOpen(): boolean {
    return this.delegated?.open === true;
  }
  get delegatedTurnSettled(): Promise<void> | undefined {
    return this.delegated?.settled;
  }
  get closeMode(): SessionCloseMode | undefined {
    return this.runtime.kind !== 'live' ? this.runtime.mode : undefined;
  }
  get interrupting(): boolean {
    return this.stop === 'stop' || this.stop === 'both';
  }
  get interruptingToSend(): boolean {
    return this.stop === 'send-now' || this.stop === 'both';
  }
  get sendNowInterrupt(): Promise<void> | undefined {
    return this.interrupt;
  }
  get pendingSends(): readonly SessionPrompt[] {
    return this.sends;
  }
  get steers(): readonly SessionPrompt[] {
    return this.heldSteers;
  }

  private setOwners(typed: TypedOwner | undefined, delegated: DelegatedOwner | undefined): void {
    if (typed && delegated) this.runtime.activity = { kind: 'overlapping', typed, delegated };
    else if (typed) this.runtime.activity = { kind: 'typed', typed };
    else if (delegated) this.runtime.activity = { kind: 'delegated', delegated };
    else this.runtime.activity = { kind: 'settling' };
  }

  beginTypedTurn(): TypedTurn {
    if (this.closeMode || this.typed || this.interrupt)
      throw new Error('Primary typed turn already owned, interrupting or closing');
    const turn = { identity: Symbol('typed turn') };
    this.setOwners({ kind: 'preparing', turn }, this.delegated);
    return turn;
  }

  attachTypedPromise(turn: TypedTurn, promise: Promise<void>): void {
    if (this.typed?.turn !== turn) throw new Error('Primary typed turn is no longer current');
    this.setOwners({ kind: 'running', turn, promise }, this.delegated);
  }

  endTypedTurn(turn: TypedTurn): boolean {
    if (this.typed?.turn !== turn) return false;
    this.setOwners(undefined, this.delegated);
    return !this.delegated;
  }

  beginDelegatedTurn(settled: Promise<void>): void {
    if (this.closeMode) throw new Error('Primary session is closing');
    this.delegatedGeneration++;
    this.setOwners(this.typed, { open: true, settled });
  }

  endDelegatedTurn(): void {
    if (this.delegated) this.delegated.open = false;
  }

  releaseDelegatedTurn(reservation: Promise<void> | undefined): boolean {
    if (!this.delegated || this.delegated.settled !== reservation) return false;
    this.setOwners(this.typed, undefined);
    return true;
  }

  requestStop(): void {
    this.stop = this.interruptingToSend ? 'both' : 'stop';
  }
  clearStop(): void {
    this.stop = this.interruptingToSend ? 'send-now' : 'none';
  }
  acknowledgeStop(stoppedTurn: Promise<void> | undefined): boolean {
    if (this.turnPromise && this.turnPromise !== stoppedTurn) return false;
    if (!this.streaming) this.clearStop();
    return true;
  }
  requestSendNow(): void {
    this.stop = this.interrupting ? 'both' : 'send-now';
  }
  refuseSendNow(): void {
    this.stop = this.interrupting ? 'stop' : 'none';
  }
  trackSendNowInterrupt(promise: Promise<void>): void {
    this.interrupt = promise;
  }
  releaseSendNowInterrupt(promise: Promise<void>): void {
    if (this.interrupt === promise) this.interrupt = undefined;
  }

  settle(): boolean {
    if (this.typed || this.delegated || this.interrupt || this.runtime.activity.kind === 'idle')
      return false;
    this.runtime.activity = { kind: 'idle' };
    this.stop = 'none';
    return true;
  }

  beginClose(mode: SessionCloseMode): void {
    const effectiveMode = this.closeMode === 'discard-pending' ? 'discard-pending' : mode;
    this.runtime = { kind: 'closing', mode: effectiveMode, activity: this.runtime.activity };
    if (effectiveMode === 'discard-pending') this.clearQueue();
  }
  reopenAfterFailedClose(): void {
    this.runtime = { kind: 'live', activity: this.runtime.activity };
  }
  completeClose(): void {
    if (this.runtime.kind !== 'closing') throw new Error('Primary session is not closing');
    this.runtime = { ...this.runtime, kind: 'closed' };
  }

  enqueue(prompt: SessionPrompt): void {
    this.sends.push(prompt);
  }
  prepend(prompts: readonly SessionPrompt[]): void {
    this.sends.unshift(...prompts);
  }
  shift(): SessionPrompt | undefined {
    return this.sends.shift();
  }
  takePending(): SessionPrompt[] {
    return this.sends.splice(0);
  }
  clearPending(): void {
    this.sends = [];
  }
  replacePending(prompts: SessionPrompt[]): void {
    this.sends = [...prompts];
  }
  holdSteer(prompt: SessionPrompt): void {
    this.heldSteers.push(prompt);
  }
  clearQueue(): void {
    this.sends = [];
    this.heldSteers = [];
  }
  removePending(prompt: SessionPrompt): boolean {
    return this.remove(this.sends, prompt);
  }
  removeSteer(prompt: SessionPrompt): boolean {
    return this.remove(this.heldSteers, prompt);
  }

  private remove(prompts: SessionPrompt[], prompt: SessionPrompt): boolean {
    const index = prompts.indexOf(prompt);
    if (index < 0) return false;
    prompts.splice(index, 1);
    return true;
  }

  summaryFields(
    canWithdrawSteer: boolean,
    publication: 'current' | 'stop-receipt' = 'current',
  ): Pick<SessionSummary, 'streaming' | 'queuedSends' | 'pendingSteers'> &
    Partial<Pick<SessionSummary, 'phase'>> {
    const pendingSteers = [...new Set([...this.heldSteers, ...this.sends])]
      .sort((a, b) => a.order - b.order)
      .flatMap((prompt) =>
        prompt.steerId
          ? [
              {
                id: prompt.steerId,
                text: userPromptDisplay(prompt.text).text,
                canWithdraw: !this.heldSteers.includes(prompt) || canWithdrawSteer,
              },
            ]
          : [],
      );
    // Stop acknowledges the command before the runtime necessarily stops draining.
    if (publication === 'stop-receipt')
      return { phase: 'paused', streaming: false, queuedSends: this.sends.length, pendingSteers };
    return { streaming: this.streaming, queuedSends: this.sends.length, pendingSteers };
  }
}
