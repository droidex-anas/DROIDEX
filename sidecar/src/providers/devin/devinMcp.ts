import type { McpServerConfig, SdkMcpServer } from '@factory/droid-sdk';
import type { McpServer } from '@agentclientprotocol/sdk';

export function devinMcpServers(configs: McpServerConfig[]): McpServer[] {
  return configs.map((config) =>
    'command' in config
      ? {
          name: config.name,
          command: config.command,
          args: config.args,
          env: Object.entries(config.env).map(([name, value]) => ({ name, value })),
        }
      : {
          name: config.name,
          type: config.type,
          url: config.url,
          headers: config.headers,
        },
  );
}

export async function startDevinMcp(
  configs: McpServerConfig[],
  servers: SdkMcpServer[],
): Promise<McpServer[]> {
  const all = [...configs];
  for (const server of servers) all.push(await server.start());
  const names = new Set<string>();
  for (const config of all) {
    if (names.has(config.name)) throw new Error(`Duplicate Devin MCP server: ${config.name}`);
    names.add(config.name);
  }
  return devinMcpServers(all);
}
