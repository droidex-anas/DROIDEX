import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SdkMcpServer, type McpServerConfig } from '@factory/droid-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { canvasError, EXPIRED_TURN } from './canvasError.js';

// The SDK's HTTP layer strips unknown arguments and formats Zod failures before
// our handler runs. Dispatch raw arguments here; retain SDK tool objects for Codex.
export class CanvasMcpServer extends SdkMcpServer {
  private listener: ReturnType<typeof createServer> | null = null;
  private endpoint: McpServerConfig | null = null;

  constructor(
    options: ConstructorParameters<typeof SdkMcpServer>[0],
    private readonly instructions?: string,
  ) {
    super(options);
  }

  override get config(): McpServerConfig | null {
    return this.endpoint;
  }

  override async start(): Promise<McpServerConfig> {
    if (this.endpoint) return this.endpoint;
    const listener = createServer((request, response) => {
      void this.serve(request, response);
    });
    this.listener = listener;
    listener.listen(0, '127.0.0.1');
    await once(listener, 'listening');
    if (this.listener !== listener) throw canvasError('scope_expired', EXPIRED_TURN);
    const address = listener.address();
    if (!address || typeof address === 'string')
      throw new Error('Canvas MCP listener is unavailable.');
    this.endpoint = {
      type: 'http',
      name: this.name,
      url: `http://127.0.0.1:${String(address.port)}/mcp`,
      headers: [],
    };
    return this.endpoint;
  }

  override async close(): Promise<void> {
    const listener = this.listener;
    this.listener = null;
    this.endpoint = null;
    if (!listener) return;
    listener.closeAllConnections();
    listener.close();
    await once(listener, 'close');
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const server = new McpServer(
      { name: this.name, version: this.version },
      { capabilities: { tools: {} }, instructions: this.instructions },
    );
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: this.tools.map((entry) => ({
        name: entry.name,
        description: entry.description,
        inputSchema: zodToJsonSchema(z.object(entry.inputSchema ?? {}).strict(), {
          target: 'jsonSchema7',
          $refStrategy: 'none',
        }),
      })),
    }));
    server.server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const entry = this.tools.find((candidate) => candidate.name === params.name);
      if (!entry) throw canvasError('invalid_input', 'Unknown Canvas tool.');
      const result = await entry.handler(params.arguments ?? {});
      return typeof result === 'string' ? { content: [{ type: 'text', text: result }] } : result;
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const bytes: unknown = chunk;
        if (typeof bytes !== 'string' && !(bytes instanceof Uint8Array))
          throw new Error('Invalid HTTP body chunk.');
        chunks.push(Buffer.from(bytes));
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent)
        response.writeHead(400, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Invalid Canvas MCP request.' },
          }),
        );
      await transport.close();
      await server.close();
    }
  }
}
