import type { DroidTool, SdkMcpServer } from '@factory/droid-sdk';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { automationToolDisplayTitle } from '../../automations/permissionPolicy.js';
import { mcpGrantSignature } from '../../mcpGrant.js';
import { nextInteractionRequestId, type ProviderInteractions } from '../interactions.js';
import { SESSIONS_MCP_SERVER_NAME, sessionsToolDisplay } from '../../sessionsMcpPolicy.js';
import { objectValue } from '../../values.js';
import type { OpenPrompts } from './codexApprovals.js';

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
  contentItems: ({ type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string })[];
  success: boolean;
}

/** What the bridge needs from the Codex session it answers for. */
export interface CodexToolSession {
  appSessionId: string;
  interactions: ProviderInteractions;
  /** The prompts of the running turn, so its approvals end with it. */
  prompts: OpenPrompts;
  threadId: () => string | undefined;
  /** The turn a call may still run in; undefined while none is, or it is being stopped. */
  turnId: () => string | undefined;
  isLive: () => boolean;
}

const TOOL_NAME = /^[a-zA-Z0-9_-]+$/;

export class CodexToolBridge {
  readonly declarations: CodexNamespace[];
  /** Names the deferred namespaces up front; without it a chat outside a
      project never looks them up and says DROIDEX gave it no tools. */
  readonly instructions: string | undefined;
  private readonly tools = new Map<
    string,
    { serverName: string; tool: DroidTool; input: z.ZodObject<Record<string, z.ZodTypeAny>> }
  >();

  constructor(
    servers: SdkMcpServer[],
    private readonly session: CodexToolSession,
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
    this.instructions = this.declarations.length
      ? [
          "This chat runs inside DROIDEX, the user's desktop app for coding agents, and DROIDEX has given it these tools. They are available now; only their full definitions load when you look them up. Use them whenever the user asks about DROIDEX, its chats, threads, projects, sidebar or automations:",
          ...this.declarations.map(({ name, description }) => `- ${name}: ${description}`),
        ].join('\n')
      : undefined;
  }

  async call(params: unknown): Promise<ToolReply> {
    const threadId = this.session.threadId();
    const turnId = this.session.turnId();
    const found = this.resolve(params, threadId);
    if ('contentItems' in found) return found;
    const call = objectValue(params);
    if (!turnId || call?.turnId !== turnId)
      return reply('This DROIDEX turn is no longer active.', false);
    const { serverName, tool, input } = found;
    const signature = mcpGrantSignature(serverName, tool.name, input);
    const display = sessionsToolDisplay(serverName, tool.name, input);
    const outcome = await this.session.prompts.ask(() =>
      this.session.interactions.requestApproval({
        request: {
          appSessionId: this.session.appSessionId,
          requestId: nextInteractionRequestId(),
          kind: 'mcp',
          canAlwaysAllow: Boolean(signature),
          title: display?.title ?? automationToolDisplayTitle(serverName, tool.name) ?? tool.name,
          detail: display?.detail ?? JSON.stringify(input),
          raw: { toolName: `mcp__${serverName}__${tool.name}`, input },
        },
        confirmationType: 'mcp_tool',
        mcpTool: { serverName, toolName: tool.name },
        ...(signature ? { signature } : {}),
      }),
    );
    if (
      !this.session.isLive() ||
      this.session.threadId() !== threadId ||
      this.session.turnId() !== turnId
    )
      return reply('This DROIDEX turn ended before the tool ran.', false);
    if (!outcome.startsWith('proceed')) return reply('The user declined this tool.', false);
    return await run(tool, input);
  }

  /** The tool a call names and its parsed input, or the reply that refuses it. */
  private resolve(
    params: unknown,
    threadId: string | undefined,
  ): ToolReply | { serverName: string; tool: DroidTool; input: Record<string, unknown> } {
    const call = objectValue(params);
    if (!call || !threadId || call.threadId !== threadId || !this.session.isLive())
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
    // A picture goes to Codex as a picture: a screenshot it cannot see is no answer.
    const contentItems: ToolReply['contentItems'] = [];
    for (const item of result.content) {
      if (item.type === 'text') contentItems.push({ type: 'inputText', text: item.text });
      else if (item.type === 'image')
        contentItems.push({
          type: 'inputImage',
          imageUrl: `data:${item.mimeType};base64,${item.data}`,
        });
      else return reply('This tool returned content Codex cannot display.', false);
    }
    return { contentItems, success: result.isError !== true };
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
