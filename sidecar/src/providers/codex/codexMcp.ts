import type { McpServerConfig } from '@factory/droid-sdk';

interface CodexMcpServer {
  url?: string;
  http_headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

// Rebuilt on every open/resume: local server URLs and bearer headers are runtime
// resources, not durable conversation settings. Never write them to config.toml.
export function codexMcpConfig(configs: McpServerConfig[] = []): Record<string, unknown> {
  const servers: Record<string, CodexMcpServer> = {};
  for (const config of configs) {
    if ('command' in config) {
      servers[config.name] = { command: config.command, args: config.args, env: config.env };
    } else if (config.type === 'http') {
      servers[config.name] = {
        url: config.url,
        http_headers: Object.fromEntries(config.headers.map(({ name, value }) => [name, value])),
      };
    } else {
      throw new Error(`Codex cannot connect to the SSE MCP server "${config.name}". Use a streamable HTTP or stdio endpoint.`);
    }
  }
  return configs.length ? { mcp_servers: servers } : {};
}
