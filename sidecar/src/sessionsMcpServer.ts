import { createSdkMcpServer } from '@factory/droid-sdk';
import { enabledDroidProfiles } from './droidProfiles.js';
import { factoryUsageTool } from './projects/factoryUsageTool.js';
import { threadTools } from './projects/threadMcpTools.js';
import { SESSIONS_MCP_SERVER_NAME } from './sessionsMcpPolicy.js';
import { sidebarTools } from './sidebar/sidebarMcpTools.js';
import type { SidebarSessions } from './sidebar/SidebarSessions.js';

// One server carries every tool that manages other chats: each in-app server
// opens a listener of its own for every session, so a second server would cost
// one more per chat.
export function createSessionsMcpServer(
  appSessionIdForTool: () => string | undefined,
  sidebar: SidebarSessions,
  mainFactoryApiKey: () => string | undefined,
) {
  const appSessionId = () => {
    const id = appSessionIdForTool();
    if (!id) throw new Error('DROIDEX session tools are not attached to a live session yet.');
    return id;
  };
  // Reading every account's usage belongs to the local Alt experiment, so only
  // a signed-in Alt profile offers it.
  const usage = enabledDroidProfiles().length > 0 ? [factoryUsageTool(mainFactoryApiKey)] : [];

  return createSdkMcpServer({
    name: SESSIONS_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: [...threadTools(appSessionId), ...usage, ...sidebarTools(appSessionId, sidebar)],
  });
}
