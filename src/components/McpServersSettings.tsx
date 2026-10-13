import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Plus,
  RefreshCw,
  Server,
  Spinner,
  Trash,
} from '@droidex/icons';
import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { bridge } from '../lib/bridge';
import {
  addMcpServer,
  authenticateMcpServer,
  listMcpServers,
  removeMcpServer,
  toggleMcpServer,
} from '../lib/commands';
import type { McpServerInfo, McpServerInput, McpStatusSummary, McpToolInfo } from '../types/bridge';
import { AddMcpServerDialog } from './McpServerForm';
import { GroupLabel, SectionTitle } from './settingsKit';
import { Switch } from './Switch';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';

let requestSequence = 0;
const nextRequestId = () => `mcp-${Date.now().toString(36)}-${String(++requestSequence)}`;

interface McpServersSectionProps {
  servers: McpServerInfo[];
  tools: McpToolInfo[];
  summary: McpStatusSummary;
  isLoading: boolean;
  isMutating: boolean;
  error?: string;
  onRefresh: () => void;
  onAdd: (server: McpServerInput) => void;
  onRemove: (serverName: string) => void;
  onToggle: (serverName: string, enabled: boolean) => void;
  onAuthenticate: (serverName: string) => void;
}

const EMPTY_SUMMARY: McpStatusSummary = {
  total: 0,
  connected: 0,
  connecting: 0,
  failed: 0,
  disabled: 0,
};

export function McpServersSettings({ cwd }: { cwd?: string }) {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [tools, setTools] = useState<McpToolInfo[]>([]);
  const [summary, setSummary] = useState<McpStatusSummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string>();
  const activeRequest = useRef<string | undefined>(undefined);
  const listedCwd = useRef(cwd);

  const start = useCallback((mutation: boolean, send: (requestId: string) => void) => {
    const requestId = nextRequestId();
    activeRequest.current = requestId;
    setError(undefined);
    if (mutation) setIsMutating(true);
    else setIsLoading(true);
    send(requestId);
  }, []);

  const refresh = useCallback(() => {
    start(false, (requestId) => {
      listMcpServers(requestId, cwd);
    });
  }, [cwd, start]);

  useEffect(() => {
    const unsubscribe = bridge.subscribe((event) => {
      if (!('requestId' in event) || event.requestId !== activeRequest.current) return;
      if (event.type === 'mcp.authRequested' && event.authUrl) {
        void window.droidex?.openExternal(event.authUrl);
        return;
      }
      if (event.type === 'mcp.error') {
        setError(event.message);
        setIsLoading(false);
        setIsMutating(false);
        return;
      }
      if (event.type !== 'mcp.catalog') return;
      setServers(event.servers);
      setTools(event.tools);
      setSummary(event.summary);
      setIsLoading(false);
      setIsMutating(false);
    });
    // A new cwd means a new catalog; drop the old rows so they never read as
    // the new folder's servers while the list is loading.
    if (listedCwd.current !== cwd) {
      listedCwd.current = cwd;
      setServers([]);
      setTools([]);
      setSummary(EMPTY_SUMMARY);
    }
    refresh();
    return unsubscribe;
  }, [cwd, refresh]);

  return (
    <McpServersSection
      servers={servers}
      tools={tools}
      summary={summary}
      isLoading={isLoading}
      isMutating={isMutating}
      error={error}
      onRefresh={refresh}
      onAdd={(server) => {
        start(true, (requestId) => {
          addMcpServer(requestId, server, cwd);
        });
      }}
      onRemove={(serverName) => {
        if (!window.confirm(`Remove the user MCP server “${serverName}”?`)) return;
        start(true, (requestId) => {
          removeMcpServer(requestId, serverName, cwd);
        });
      }}
      onToggle={(serverName, enabled) => {
        start(true, (requestId) => {
          toggleMcpServer(requestId, serverName, enabled, cwd);
        });
      }}
      onAuthenticate={(serverName) => {
        start(true, (requestId) => {
          authenticateMcpServer(requestId, serverName, cwd);
        });
      }}
    />
  );
}

export function McpServersSection(props: McpServersSectionProps) {
  const [isAdding, setIsAdding] = useState(false);
  const addStarted = useRef(false);
  const toolsByServer = useMemo(() => {
    const grouped = new Map<string, McpToolInfo[]>();
    for (const tool of props.tools) {
      const current = grouped.get(tool.serverName) ?? [];
      current.push(tool);
      grouped.set(tool.serverName, current);
    }
    return grouped;
  }, [props.tools]);

  useEffect(() => {
    if (!isAdding || !addStarted.current || props.isMutating) return;
    if (!props.error) setIsAdding(false);
    addStarted.current = false;
  }, [isAdding, props.error, props.isMutating]);

  let serverList: React.ReactNode;
  if (props.isLoading && props.servers.length === 0) {
    serverList = (
      <div className="flex items-center gap-2 rounded-xl bg-surface px-4 py-5 text-body text-muted shadow-lg">
        <Spinner className="size-icon-md motion-safe:animate-spin-slow" /> Loading MCP servers…
      </div>
    );
  } else if (props.servers.length === 0) {
    serverList = (
      <div className="rounded-xl bg-surface px-5 py-8 text-center">
        <Server className="mx-auto mb-2 size-icon-lg text-muted" />
        <div className="text-body-strong text-primary">No MCP servers configured</div>
        <div className="mt-1 text-caption text-muted">
          Add a user server here or define a project server in .factory/mcp.json.
        </div>
      </div>
    );
  } else {
    serverList = (
      <div className="divide-y divide-divider overflow-hidden rounded-xl bg-surface shadow-lg">
        {props.servers.map((server) => (
          <McpServerCard
            key={`${server.source}:${server.name}`}
            server={server}
            tools={toolsByServer.get(server.name) ?? []}
            disabled={props.isMutating}
            onRemove={props.onRemove}
            onToggle={props.onToggle}
            onAuthenticate={props.onAuthenticate}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <SectionTitle
          title="MCP servers"
          sub="Shows Droid's effective server catalog and authentication state. User and project servers are merged with DROIDEX browser tools when sessions start."
        />
        <Button
          variant="ghost"
          icon={RefreshCw}
          loading={props.isLoading}
          onClick={props.onRefresh}
          disabled={props.isLoading || props.isMutating}
          aria-label="Refresh MCP servers"
        />
      </div>

      <div className="mb-5 flex items-center gap-2 text-caption text-muted">
        <span>{props.summary.connected} connected</span>
        <span>·</span>
        <span>{props.summary.disabled ?? 0} disabled</span>
        {props.summary.failed > 0 && (
          <>
            <span>·</span>
            <span className="text-warning">{props.summary.failed} failed</span>
          </>
        )}
      </div>

      {props.error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-body text-primary">
          <CircleAlert className="mt-0.5 size-icon-md shrink-0 text-warning" />
          <span>{props.error}</span>
        </div>
      )}

      {serverList}

      <Button
        icon={Plus}
        className="mt-5"
        onClick={() => {
          setIsAdding(true);
        }}
      >
        Add server
      </Button>

      <AnimatePresence>
        {isAdding && (
          <AddMcpServerDialog
            disabled={props.isMutating}
            serverError={props.error}
            onCancel={() => {
              if (!props.isMutating) setIsAdding(false);
            }}
            onAdd={(server) => {
              addStarted.current = true;
              props.onAdd(server);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function McpServerCard({
  server,
  tools,
  disabled,
  onRemove,
  onToggle,
  onAuthenticate,
}: {
  server: McpServerInfo;
  tools: McpToolInfo[];
  disabled: boolean;
  onRemove: (serverName: string) => void;
  onToggle: (serverName: string, enabled: boolean) => void;
  onAuthenticate: (serverName: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isEnabled = server.status !== 'disabled';
  const canRemove = server.source === 'user' && !server.isManaged;
  const shouldShowAuthenticate = canAuthenticate(server);

  return (
    <div className="group px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => {
            setExpanded((value) => !value);
          }}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-sm text-left active:opacity-70"
        >
          <ChevronRight
            className={`size-icon-sm shrink-0 text-muted transition-transform duration-100 ${expanded ? 'rotate-90' : ''}`}
          />
          <StatusIcon status={server.status} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-body-strong text-primary">{server.name}</span>
              <Badge>{sourceLabel(server.source)}</Badge>
              {server.serverType && (
                <span className="font-mono text-code-sm text-muted">{server.serverType}</span>
              )}
            </span>
            <span className="mt-0.5 block text-caption capitalize text-muted">
              {server.status}
              {server.toolCount !== undefined
                ? ` · ${String(server.toolCount)} ${server.toolCount === 1 ? 'tool' : 'tools'}`
                : ''}
            </span>
          </span>
        </button>
        {shouldShowAuthenticate && (
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => {
              onAuthenticate(server.name);
            }}
          >
            Authenticate
          </Button>
        )}
        <Switch
          checked={isEnabled}
          disabled={disabled}
          onChange={(enabled) => {
            onToggle(server.name, enabled);
          }}
          label={`${isEnabled ? 'Disable' : 'Enable'} ${server.name}`}
        />
        {canRemove && (
          <Button
            variant="ghost"
            icon={Trash}
            disabled={disabled}
            aria-label={`Remove ${server.name}`}
            onClick={() => {
              onRemove(server.name);
            }}
          />
        )}
      </div>
      {expanded && (
        <div className="ml-6 mt-3 border-l border-divider pl-4">
          {server.error && <div className="mb-3 text-caption text-warning">{server.error}</div>}
          {tools.length === 0 ? (
            <div className="py-1 text-caption text-muted">No tools reported.</div>
          ) : (
            <>
              <GroupLabel>Available tools</GroupLabel>
              <div className="grid gap-x-6 gap-y-3 pb-1 sm:grid-cols-2">
                {tools.map((tool) => (
                  <div key={tool.name} className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-label text-secondary">{tool.name}</span>
                      {!tool.isEnabled && <Badge>Off</Badge>}
                    </div>
                    {tool.description && (
                      <div className="mt-0.5 line-clamp-2 text-caption text-muted">
                        {tool.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function canAuthenticate(server: McpServerInfo): boolean {
  if (server.serverType === 'stdio') return false;
  if (server.requiresAuth === true) return true;
  return (server.status === 'failed' || server.status === 'disconnected') && !server.hasAuthTokens;
}

function StatusIcon({ status }: { status: McpServerInfo['status'] }) {
  if (status === 'connected') return <CircleCheck className="size-icon-md text-success" />;
  if (status === 'connecting')
    return <Spinner className="size-icon-md motion-safe:animate-spin-slow text-accent" />;
  if (status === 'failed') return <CircleAlert className="size-icon-md text-warning" />;
  return <Server className="size-icon-md text-muted" />;
}

function sourceLabel(source: McpServerInfo['source']): string {
  if (source === 'user') return 'User';
  if (source === 'project') return 'Project';
  if (source === 'folder') return 'Folder';
  if (source === 'org') return 'Organization';
  if (source === 'runtime') return 'DROIDEX';
  if (source === 'builtin') return 'Built in';
  return source;
}
