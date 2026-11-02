export const COVER_TSX = `import { Fragment } from 'react';
import { ChevronRight, GitBranch, RotateCcw, ScrollText, Search } from 'lucide-react';
import { Badge, Button } from '@droidex/design-system';

const DEPLOYS = [
  { hash: 'a91c3e0', message: 'Retry webhook deliveries with backoff', branch: 'main', when: '40s ago', state: 'Building' },
  { hash: '4f2c9a1', message: 'Cache exchange rates for 15 minutes', branch: 'main', when: '2h ago', state: 'Ready' },
  { hash: 'e03b7d2', message: 'Bump pg to 8.12.0', branch: 'deps/pg', when: '5h ago', state: 'Failed' },
  { hash: '77d0f19', message: 'Paginate the ledger export', branch: 'main', when: 'Yesterday', state: 'Ready' },
  { hash: '2b6e4c8', message: 'Add idempotency keys to transfers', branch: 'main', when: '2 days ago', state: 'Ready' },
] as const;

const STATE = {
  Building: 'ds-caption ds-status text-[color:var(--ds-warning)]',
  Ready: 'ds-caption ds-status text-[color:var(--ds-positive)]',
  Failed: 'ds-caption ds-status text-[color:var(--ds-danger)]',
};

const LOG = [
  { time: '12:04:31.218', level: 'info', text: 'Cloning northwind/ledger-api at a91c3e0' },
  { time: '12:04:32.940', level: 'info', text: 'Restored build cache (412 MB)' },
  { time: '12:04:41.077', level: 'info', text: 'npm ci: added 1,204 packages in 8.1s' },
  { time: '12:04:58.512', level: 'warn', text: 'punycode is deprecated; use a userland alternative' },
  { time: '12:05:06.330', level: 'info', text: 'tsc --build: 0 errors' },
  { time: '12:05:09.884', level: 'info', text: 'Running 312 tests across 8 workers' },
  { time: '12:05:21.402', level: 'info', text: '312 passed in 11.5s' },
  { time: '12:05:22.016', level: 'info', text: 'Building image ledger-api:a91c3e0' },
];

const LEVEL: Record<string, string> = {
  info: 'text-[color:var(--ds-fg-muted)]',
  warn: 'text-[color:var(--ds-warning)]',
};

export default function Cover() {
  return (
    <main
      className="relative h-[480px] w-[1200px] overflow-hidden"
      style={{ background: 'radial-gradient(1100px 560px at 88% -8%, var(--ds-surface), var(--ds-canvas) 66%)' }}
    >
      <div className="absolute left-14 right-14 top-12 flex items-end gap-12">
        <div className="flex flex-col gap-3">
          <span className="ds-subheading">Basalt</span>
          <h1 className="ds-title">Let the output be the loudest thing on screen.</h1>
        </div>
        <p className="ds-body ds-text-muted ml-auto w-[340px]">
          Dark-first chrome in Instrument Sans, JetBrains Mono for code and logs only, and one lava accent
          for the thing that needs you.
        </p>
      </div>

      <div className="absolute left-14 top-[170px] flex h-[360px] w-[1144px] flex-col overflow-hidden rounded-t-[var(--ds-radius-2xl)] bg-[color:var(--ds-surface)] shadow-[var(--ds-shadow-lg)]">
        <header className="flex h-11 shrink-0 items-center gap-2 bg-[color:var(--ds-raised)] px-4">
          <span className="ds-label ds-text-muted">northwind</span>
          <ChevronRight size={14} aria-hidden="true" className="text-[color:var(--ds-fg-quiet)]" />
          <span className="ds-label ds-text-muted">ledger-api</span>
          <ChevronRight size={14} aria-hidden="true" className="text-[color:var(--ds-fg-quiet)]" />
          <span className="ds-label">Deployments</span>
          <Badge className="ml-2">production</Badge>
          <div className="ml-auto flex h-7 w-60 items-center gap-2 rounded-[var(--ds-radius-md)] bg-[color:var(--ds-elevated)] px-2.5 text-[color:var(--ds-fg-muted)]">
            <Search size={14} aria-hidden="true" />
            <span className="ds-caption">Search or run a command</span>
            <span className="ml-auto flex gap-0.5">
              <kbd className="ds-kbd">⌘</kbd>
              <kbd className="ds-kbd">K</kbd>
            </span>
          </div>
          <Button>Deploy</Button>
        </header>

        <div className="flex min-h-0 flex-1">
          <ul className="m-0 flex w-[392px] shrink-0 list-none flex-col gap-0.5 p-2">
            {DEPLOYS.map((deploy) => (
              <li key={deploy.hash} className="ds-row" aria-current={deploy.hash === 'a91c3e0' ? 'true' : undefined}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="ds-label truncate">{deploy.message}</span>
                  <span className="ds-caption ds-text-muted flex items-center gap-2">
                    <code className="ds-code">{deploy.hash}</code>
                    <GitBranch size={12} aria-hidden="true" />
                    {deploy.branch}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className={STATE[deploy.state]} data-state={deploy.state === 'Building' ? 'running' : undefined}>
                    {deploy.state}
                  </span>
                  <span className="ds-caption ds-text-quiet">{deploy.when}</span>
                </div>
              </li>
            ))}
          </ul>

          <section className="flex min-w-0 flex-1 flex-col bg-[color:var(--ds-canvas)]">
            <div className="flex h-10 shrink-0 items-center gap-3 px-4">
              <span className="ds-label">Build log</span>
              <code className="ds-code ds-text-muted">a91c3e0</code>
              <span className="ds-caption ds-text-quiet ml-auto">Following · 1m 51s</span>
            </div>
            <div className="ds-log px-4">
              {LOG.map((line) => (
                <Fragment key={line.time}>
                  <span className="ds-text-quiet">{line.time}</span>
                  <span className={LEVEL[line.level]}>{line.level}</span>
                  <span className="ds-text-secondary">{line.text}</span>
                </Fragment>
              ))}
              <span className="ds-text-quiet">12:05:23.540</span>
              <span className="text-[color:var(--ds-fg-muted)]">info</span>
              <span className="flex items-center gap-1 ds-text-secondary">
                Pushing layer 3 of 7
                <span className="h-3.5 w-1.5 bg-[color:var(--ds-accent)]" />
              </span>
            </div>
          </section>
        </div>
      </div>

      <div className="ds-card absolute left-[744px] top-[262px] flex w-[408px] flex-col shadow-[var(--ds-shadow-lg)]">
        <div className="flex h-11 items-center gap-2.5 px-4">
          <Search size={16} aria-hidden="true" className="text-[color:var(--ds-fg-muted)]" />
          <span className="ds-body">roll</span>
          <span className="-ml-2 h-4 w-px bg-[color:var(--ds-accent)]" />
          <span className="ds-caption ds-text-quiet ml-auto">ledger-api</span>
        </div>
        <div className="flex flex-col gap-0.5 p-1.5 pt-0">
          <div className="ds-row bg-[color:var(--ds-active)]">
            <RotateCcw size={16} aria-hidden="true" className="text-[color:var(--ds-accent)]" />
            <span className="ds-label">Roll back production to</span>
            <code className="ds-code -ml-1.5 ds-text-muted">4f2c9a1</code>
            <kbd className="ds-kbd ml-auto">↵</kbd>
          </div>
          <div className="ds-row">
            <RotateCcw size={16} aria-hidden="true" className="text-[color:var(--ds-fg-muted)]" />
            <span className="ds-label ds-text-secondary">Roll back preview to</span>
            <code className="ds-code -ml-1.5 ds-text-muted">77d0f19</code>
          </div>
          <div className="ds-row">
            <ScrollText size={16} aria-hidden="true" className="text-[color:var(--ds-fg-muted)]" />
            <span className="ds-label ds-text-secondary">Open runtime logs</span>
          </div>
        </div>
      </div>
    </main>
  );
}
`;
