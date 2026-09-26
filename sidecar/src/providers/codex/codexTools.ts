import type { DroidTool, SdkMcpServer } from '@factory/droid-sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { automationToolDisplayTitle } from '../../automations/permissionPolicy.js';
import { mcpGrantSignature } from '../../mcpGrant.js';
import { nextInteractionRequestId, type ProviderInteractions } from '../interactions.js';
import { SESSIONS_MCP_SERVER_NAME, sessionsToolDisplayTitle } from '../../sessionsMcpPolicy.js';
import { objectValue } from '../../values.js';

interface CodexTool {
  type: 'function';
  name: string;
  description: string;
  inputSchema: ReturnType<typeof zodToJsonSchema>;
  deferLoading: true;
}

interface CodexNamespace {
  type: 'namespace';
  name: string;
  description: string;
  tools: CodexTool[];
}

interface ToolReply {
  contentItems: { type: 'inputText'; text: string }[];
  success: boolean;
}

const TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

export class CodexToolBridge {
  readonly declarations: CodexNamespace[];
  private readonly tools = new Map<
    string,
    { serverName: string; tool: DroidTool; input: z.ZodObject<Record<string, z.ZodTypeAny>> }
  >();

  constructor(
    servers: SdkMcpServer[],
    private readonly appSessionId: string,
    private readonly interactions: ProviderInteractions,
    private readonly currentThreadId: () => string | undefined,
    private readonly isLive: () => boolean,
  ) {
    this.declarations = servers.map((server) => {
      const namespace = server.name.replaceAll('-', '_');
      if (!TOOL_NAME.test(namespace)) throw new Error(`Invalid Codex tool namespace: ${namespace}`);
      const tools = server.tools.map((tool) => {
        if (!TOOL_NAME.test(tool.name)) throw new Error(`Invalid Codex tool name: ${tool.name}`);
        const input = z.object(tool.inputSchema ?? {});
        this.tools.set(`${namespace}/${tool.name}`, { serverName: server.name, tool, input });
        return {
          type: 'function' as const,
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: zodToJsonSchema(input, {
            target: 'jsonSchema7',
            $refStrategy: 'none',
          }),
          deferLoading: true as const,
        };
      });
      return {
        type: 'namespace',
        name: namespace,
        // The only text the model sees before it looks a deferred tool up.
        description:
          server.name === SESSIONS_MCP_SERVER_NAME
            ? "DROIDEX app tools: start chats and threads, keep a project plan, and list, read, message, stop or settle the chats in the user's sidebar, including what needs the user."
            : 'DROIDEX automations: schedule a prompt or a recurring task, and list, change, pause, run now or remove scheduled ones.',
        tools,
      };
    });
  }

  async call(params: unknown): Promise<ToolReply> {
    const threadId = this.currentThreadId();
    const found = this.resolve(params, threadId);
    if ('contentItems' in found) return found;
    const { serverName, tool, input } = found;
    const signature = mcpGrantSignature(serverName, tool.name, input);
    const outcome = await this.interactions.requestApproval({
      request: {
        appSessionId: this.appSessionId,
        requestId: nextInteractionRequestId(),
        kind: 'mcp',
        title:
          sessionsToolDisplayTitle(serverName, tool.name) ??
          automationToolDisplayTitle(serverName, tool.name) ??
          tool.name,
        detail: JSON.stringify(input),
        raw: { toolName: `mcp__${serverName}__${tool.name}`, input },
      },
      confirmationType: 'mcp_tool',
      mcpTool: { serverName, toolName: tool.name },
      ...(signature ? { signature } : {}),
    });
    if (!this.isLive() || this.currentThreadId() !== threadId)
      return reply('This DROIDEX chat closed before the tool ran.', false);
    if (!outcome.startsWith('proceed')) return reply('The user declined this tool.', false);
    return await run(tool, input);
  }

  /** The tool a call names and its parsed input, or the reply that refuses it. */
  private resolve(
    params: unknown,
    threadId: string | undefined,
  ): ToolReply | { serverName: string; tool: DroidTool; input: Record<string, unknown> } {
    const call = objectValue(params);
    if (!call || !threadId || call.threadId !== threadId || !this.isLive())
      return reply('This DROIDEX chat is no longer available.', false);
    const entry =
      typeof call.namespace === 'string' && typeof call.tool === 'string'
        ? this.tools.get(`${call.namespace}/${call.tool}`)
        : undefined;
    if (!entry) return reply('Unknown DROIDEX tool.', false);
    try {
      return {
        serverName: entry.serverName,
        tool: entry.tool,
        input: entry.input.parse(call.arguments),
      };
    } catch (error) {
      return reply(`Invalid tool arguments: ${message(error)}`, false);
    }
  }
}

async function run(tool: DroidTool, input: Record<string, unknown>): Promise<ToolReply> {
  try {
    const result = await tool.handler(input);
    if (typeof result === 'string') return reply(result, true);
    if (!result.content.every((item) => item.type === 'text'))
      return reply('This tool returned content Codex cannot display.', false);
    return reply(result.content.map((item) => item.text).join('\n'), result.isError !== true);
  } catch (error) {
    return reply(message(error), false);
  }
}

function reply(text: string, success: boolean): ToolReply {
  return { contentItems: [{ type: 'inputText', text }], success };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
