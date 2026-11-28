import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  RequestError,
  type CreateTerminalRequest,
  type SessionNotification,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitResponse,
} from '@agentclientprotocol/sdk/unstable';
import { childEnv } from '../../childEnv.js';
import type { ProviderProcess } from '../session.js';
import { DevinTerminalProcess } from './devinTerminalProcess.js';

const DEFAULT_OUTPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_TERMINALS = 64;
const MAX_RUNNING = 16;

interface Terminal {
  id: string;
  process: DevinTerminalProcess;
  buffer: Buffer;
  limit: number;
  truncated: boolean;
  released: boolean;
  exitStatus?: WaitForTerminalExitResponse;
  exited: Promise<WaitForTerminalExitResponse>;
}

export class DevinTerminals {
  private readonly terminals = new Map<string, Terminal>();
  private readonly bindings = new Map<string, SessionNotification>();
  private readonly processListeners = new Set<(roots: readonly ProviderProcess[]) => void>();
  private accepting = true;
  private closed = false;
  private generation = 0;
  private closing?: Promise<void>;

  constructor(
    private readonly cwd: string,
    private readonly isCurrent: (sessionId: string) => boolean,
    private readonly update: (notification: SessionNotification) => void,
  ) {}

  async create(request: CreateTerminalRequest): Promise<{ terminalId: string }> {
    this.requireSession(request.sessionId);
    if (!this.accepting)
      throw RequestError.invalidParams(undefined, 'Devin terminal execution was stopped.');
    if (
      request.outputByteLimit != null &&
      (!Number.isSafeInteger(request.outputByteLimit) || request.outputByteLimit < 0)
    )
      throw RequestError.invalidParams(
        undefined,
        'Terminal outputByteLimit must be a non-negative integer.',
      );
    if (request.cwd && !isAbsolute(request.cwd))
      throw RequestError.invalidParams(undefined, 'Terminal cwd must be absolute.');
    const running = [...this.terminals.values()].filter((terminal) => terminal.process.isAlive());
    if (running.length >= MAX_RUNNING)
      throw RequestError.invalidParams(undefined, 'Too many running Devin terminals.');
    for (const [id, terminal] of this.terminals) {
      if (this.terminals.size < MAX_TERMINALS) break;
      if (terminal.released) this.terminals.delete(id);
    }
    if (this.terminals.size >= MAX_TERMINALS)
      throw RequestError.invalidParams(undefined, 'Too many unreleased Devin terminals.');
    const generation = this.generation;
    const id = randomUUID();
    const env = {
      ...childEnv(),
      ...Object.fromEntries((request.env ?? []).map(({ name, value }) => [name, value])),
    };
    const process = new DevinTerminalProcess(
      request.command,
      request.args ?? [],
      request.cwd ?? this.cwd,
      env,
      (chunk) => {
        if (this.closed) return;
        terminal.buffer = Buffer.concat([terminal.buffer, Buffer.from(chunk)]);
        this.trim(terminal, terminal.limit);
        this.trimTotal();
        this.publish(id);
      },
    );
    const terminal: Terminal = {
      id,
      process,
      buffer: Buffer.alloc(0),
      limit: Math.min(request.outputByteLimit ?? DEFAULT_OUTPUT_BYTES, MAX_OUTPUT_BYTES),
      truncated: false,
      released: false,
      exited: process.exited,
    };
    this.terminals.set(id, terminal);
    void process.closed.then(() => {
      this.publishProcesses();
    });
    void process.exited.then((status) => {
      terminal.exitStatus = status;
    });
    try {
      this.publishProcesses();
      await process.started;
      this.requireSession(request.sessionId);
      if (generation !== this.generation) throw new Error('Devin terminal creation was cancelled.');
    } catch (error) {
      await terminal.process.stop();
      this.terminals.delete(id);
      throw RequestError.internalError(
        undefined,
        error instanceof Error ? error.message : 'Terminal creation failed.',
      );
    }
    return { terminalId: id };
  }

  output(request: TerminalOutputRequest): TerminalOutputResponse {
    return this.snapshot(this.requireTerminal(request));
  }

  waitForExit(request: TerminalOutputRequest): Promise<WaitForTerminalExitResponse> {
    return this.requireTerminal(request).exited;
  }

  async kill(request: TerminalOutputRequest): Promise<Record<string, never>> {
    await this.requireTerminal(request).process.stop();
    return {};
  }

  async release(request: TerminalOutputRequest): Promise<Record<string, never>> {
    this.requireSession(request.sessionId);
    const terminal = this.terminals.get(request.terminalId);
    if (!terminal) return {};
    terminal.released = true;
    await terminal.process.stop();
    return {};
  }

  startTurn(): void {
    if (!this.closed) this.accepting = true;
  }

  onProcessRootsChanged(listener: (roots: readonly ProviderProcess[]) => void): () => void {
    if (!this.closed) this.processListeners.add(listener);
    listener(this.processRoots());
    return () => {
      this.processListeners.delete(listener);
    };
  }

  private processRoots(): ProviderProcess[] {
    return [...this.terminals.values()].flatMap(({ process }) => {
      const pid = process.child.pid;
      return pid !== undefined && process.isAlive()
        ? [{ pid, displayCommand: process.displayCommand, isAlive: () => process.isAlive() }]
        : [];
    });
  }

  private publishProcesses(): void {
    const roots = this.processRoots();
    for (const listener of this.processListeners) listener(roots);
  }

  interrupt(): Promise<void> {
    this.accepting = false;
    this.generation += 1;
    return Promise.all(
      [...this.terminals.values()].map((terminal) => terminal.process.stop()),
    ).then(() => undefined);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.bindings.clear();
    this.closing = this.interrupt().then(() => {
      this.terminals.clear();
      this.processListeners.clear();
    });
    return this.closing;
  }

  resolve(notification: SessionNotification): SessionNotification {
    const { update } = notification;
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update')
      return notification;
    const owner = JSON.stringify([
      update._meta?.['cognition.ai/subagent_context'],
      update.toolCallId,
    ]);
    if (update.content?.some((content) => content.type === 'terminal')) {
      this.bindings.set(owner, notification);
      if (this.bindings.size > 256) {
        const oldest = this.bindings.keys().next().value;
        if (oldest !== undefined) this.bindings.delete(oldest);
      }
    }
    const resolved = this.resolveContent(notification);
    if (update.status === 'completed' || update.status === 'failed') this.bindings.delete(owner);
    return resolved;
  }

  private resolveContent(notification: SessionNotification): SessionNotification {
    const { update } = notification;
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update')
      return notification;
    if (!update.content) return notification;
    return {
      ...notification,
      update: {
        ...update,
        content: update.content.map((content) => {
          if (content.type !== 'terminal') return content;
          const terminal = this.terminals.get(content.terminalId);
          return {
            type: 'content' as const,
            content: {
              type: 'text' as const,
              text: terminal ? this.snapshot(terminal).output : `[terminal ${content.terminalId}]`,
            },
          };
        }),
      },
    };
  }

  private publish(id: string): void {
    if (this.closed) return;
    for (const notification of this.bindings.values()) {
      const { update } = notification;
      if (
        (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') &&
        update.content?.some((content) => content.type === 'terminal' && content.terminalId === id)
      )
        this.update(
          this.resolveContent({
            ...notification,
            update: {
              sessionUpdate: 'tool_call_update',
              toolCallId: update.toolCallId,
              content: update.content,
              _meta: update._meta,
            },
          }),
        );
    }
  }

  private requireSession(sessionId: string): void {
    if (this.closed || !this.isCurrent(sessionId))
      throw RequestError.invalidParams(undefined, 'Devin terminal session is not active.');
  }

  private requireTerminal(request: TerminalOutputRequest): Terminal {
    this.requireSession(request.sessionId);
    const terminal = this.terminals.get(request.terminalId);
    if (!terminal || terminal.released)
      throw RequestError.invalidParams(undefined, 'Unknown Devin terminal.');
    return terminal;
  }

  private snapshot(terminal: Terminal): TerminalOutputResponse {
    return {
      output: terminal.buffer.toString('utf8'),
      truncated: terminal.truncated,
      ...(terminal.exitStatus ? { exitStatus: terminal.exitStatus } : {}),
    };
  }

  private trim(terminal: Terminal, limit: number): void {
    if (terminal.buffer.length <= limit) return;
    let start = terminal.buffer.length - limit;
    while (start < terminal.buffer.length && (terminal.buffer[start] & 0xc0) === 0x80) start += 1;
    terminal.buffer = Buffer.from(terminal.buffer.subarray(start));
    terminal.truncated = true;
  }

  private trimTotal(): void {
    let bytes = [...this.terminals.values()].reduce(
      (sum, terminal) => sum + terminal.buffer.length,
      0,
    );
    for (const terminal of this.terminals.values()) {
      if (bytes <= MAX_TOTAL_BYTES) break;
      const before = terminal.buffer.length;
      this.trim(terminal, Math.max(0, before - (bytes - MAX_TOTAL_BYTES)));
      bytes -= before - terminal.buffer.length;
    }
  }
}
