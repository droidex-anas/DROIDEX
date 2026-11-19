import type { ClientCommand } from './protocol.js';

export type RuntimeCommand = Extract<
  ClientCommand,
  {
    type:
      | 'connect'
      | 'runtime.status'
      | 'auth.status'
      | 'env.detect'
      | 'cli.install'
      | 'cli.update'
      | 'catalog.models'
      | 'provider.refresh'
      | 'usage.refresh'
      | 'catalog.tools'
      | 'catalog.skills'
      | 'settings.defaults'
      | 'app.backgroundWork'
      | 'settings.agent.update'
      | 'settings.compaction.update';
  }
>;

export type SessionCommand = Exclude<
  Extract<ClientCommand, { type: `session.${string}` }>,
  HistoryCommand
>;

export type HistoryCommand = Extract<
  ClientCommand,
  {
    type:
      | `history.${string}`
      | `sessions.${string}`
      | 'session.exportMarkdown'
      | 'session.loadHistory';
  }
>;
