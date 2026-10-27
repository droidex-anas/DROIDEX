import {
  ProcessTransport,
  type DroidClientTransport,
  type ProcessTransportOptions,
} from '@factory/droid-sdk';
import type { ChildProcess } from 'node:child_process';

const PERMISSION_OPTION_ALIASES: Record<string, string> = {
  proceed_always_file: 'proceed_always',
  proceed_always_server: 'proceed_always',
  proceed_always_tools: 'proceed_always',
};

export type ConnectableDroidTransport = DroidClientTransport & {
  connect(): Promise<void>;
  readonly processId: number | undefined;
};

export function createDroidTransport(options: ProcessTransportOptions): ConnectableDroidTransport {
  return wrapDroidTransport(new ProcessTransport(options));
}

export function wrapDroidTransport(inner: DroidClientTransport): ConnectableDroidTransport {
  return new PermissionNormalizingTransport(inner);
}

export function normalizeDroidTransportMessage(
  message: Record<string, unknown>,
): Record<string, unknown> {
  const method = message.method;
  if (method !== 'droid.request_permission' && method !== 'daemon.request_permission')
    return message;

  const params = message.params;
  if (!isRecord(params)) return message;

  const toolUses = expandScriptToolUses(params.toolUses);
  const options = normalizePermissionOptions(params.options);
  if (toolUses === params.toolUses && options === params.options) return message;
  return { ...message, params: { ...params, toolUses, options } };
}

function normalizePermissionOptions(options: unknown): unknown {
  if (!Array.isArray(options)) return options;
  const normalized = options.map((option: unknown) => {
    if (!isRecord(option) || typeof option.value !== 'string') return option;
    const value = PERMISSION_OPTION_ALIASES[option.value];
    return value ? { ...option, value } : option;
  });
  return normalized.some((option, index) => option !== options[index]) ? normalized : options;
}

// Droid CLI 0.119 runs tool calls inside its Script tool and asks once for the
// whole script (`details.type === 'script'`), a shape the installed SDK rejects
// before any handler runs. Each script becomes its calls' own confirmations, as
// the CLI's own prompt lists them, so the one answer is decided by the existing
// bundle rules. Remove once the SDK's RequestPermission schema accepts `script`.
function expandScriptToolUses(toolUses: unknown): unknown {
  if (!Array.isArray(toolUses) || !toolUses.some(isScriptToolUse)) return toolUses;
  const expanded: unknown[] = [];
  for (const toolUse of toolUses) {
    if (!isScriptToolUse(toolUse)) {
      expanded.push(toolUse);
      continue;
    }
    const calls = scriptCalls(toolUse);
    // Left as is, the SDK refuses the request, so an unreadable script is
    // never approved on behalf of calls nobody could see.
    if (!calls) return toolUses;
    expanded.push(...calls);
  }
  return expanded;
}

type ScriptToolUse = Record<string, unknown> & { details: Record<string, unknown> };

function isScriptToolUse(toolUse: unknown): toolUse is ScriptToolUse {
  return isRecord(toolUse) && isRecord(toolUse.details) && toolUse.details.type === 'script';
}

function scriptCalls({ toolUse, details }: ScriptToolUse): Record<string, unknown>[] | null {
  if (!isRecord(toolUse) || typeof toolUse.id !== 'string') return null;
  if (!Array.isArray(details.calls) || details.calls.length === 0) return null;
  const calls: Record<string, unknown>[] = [];
  for (const [index, call] of details.calls.entries()) {
    if (!isRecord(call) || typeof call.toolName !== 'string' || !isRecord(call.toolInput))
      return null;
    const confirmation = call.confirmation;
    if (!isRecord(confirmation) || typeof confirmation.type !== 'string') return null;
    calls.push({
      toolUse: {
        type: 'tool_use',
        id: `${toolUse.id}:${String(index)}`,
        name: call.toolName,
        input: call.toolInput,
      },
      confirmationType: confirmation.type,
      details: { ...confirmation, inScript: true },
    });
  }
  return calls;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

class PermissionNormalizingTransport implements ConnectableDroidTransport {
  private childProcess: ChildProcess | undefined;

  constructor(private readonly inner: DroidClientTransport) {}

  get isConnected(): boolean {
    return this.inner.isConnected;
  }

  // The SDK clears its reference before close finishes; retain the actual
  // child so a failed close cannot erase its still-live process identity.
  get processId(): number | undefined {
    this.childProcess ??=
      (this.inner as { childProcess?: ChildProcess | null }).childProcess ?? undefined;
    const child = this.childProcess;
    return child?.exitCode === null && child.signalCode === null ? child.pid : undefined;
  }

  connect(): Promise<void> {
    this.childProcess = undefined;
    return this.inner.connect?.() ?? Promise.resolve();
  }

  send(message: Record<string, unknown>): void {
    this.inner.send(message);
  }

  onMessage(callback: (message: Record<string, unknown>) => void): void {
    this.inner.onMessage((message) => {
      callback(normalizeDroidTransportMessage(message));
    });
  }

  onError(callback: (error: Error) => void): void {
    this.inner.onError(callback);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}
