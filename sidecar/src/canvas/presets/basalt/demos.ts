export const DEPLOYMENTS_TSX = `import { Fragment, useState } from 'react';
import { GitBranch, RotateCcw, Rocket } from 'lucide-react';
import { Badge, Button, Card, Dialog, Input, Tabs } from '@droidex/design-system';

// Newest first; the first is main's latest commit.
const DEPLOYS = [
  { id: 'd5', hash: 'a91c3e0', message: 'Retry webhook deliveries with backoff', branch: 'main', env: 'production', author: 'Priya Natarajan', when: '40s ago', took: '1m 51s', state: 'Building' },
  { id: 'd4', hash: '4f2c9a1', message: 'Cache exchange rates for 15 minutes', branch: 'main', env: 'production', author: 'Jonas Weber', when: '2h ago', took: '2m 04s', state: 'Ready' },
  { id: 'd3', hash: 'e03b7d2', message: 'Bump pg to 8.12.0', branch: 'deps/pg', env: 'preview', author: 'Renovate', when: '5h ago', took: '1m 12s', state: 'Failed' },
  { id: 'd2', hash: '77d0f19', message: 'Paginate the ledger export', branch: 'export-pages', env: 'preview', author: 'Amara Osei', when: 'Yesterday', took: '1m 58s', state: 'Ready' },
  { id: 'd1', hash: '2b6e4c8', message: 'Add idempotency keys to transfers', branch: 'main', env: 'production', author: 'Jonas Weber', when: '2 days ago', took: '2m 11s', state: 'Ready' },
];

type Deploy = (typeof DEPLOYS)[number];

const STATE: Record<string, string> = {
  Building: 'ds-caption ds-status text-[color:var(--ds-warning)]',
  Ready: 'ds-caption ds-status text-[color:var(--ds-positive)]',
  Failed: 'ds-caption ds-status text-[color:var(--ds-danger)]',
};

const LEVEL: Record<string, string> = {
  info: 'text-[color:var(--ds-fg-muted)]',
  warn: 'text-[color:var(--ds-warning)]',
  error: 'text-[color:var(--ds-danger)]',
};

function logFor(deploy: Deploy) {
  const lines = [
    { time: '12:04:31.218', level: 'info', text: 'Cloning northwind/ledger-api at ' + deploy.hash },
    { time: '12:04:32.940', level: 'info', text: 'Restored build cache (412 MB)' },
    { time: '12:04:41.077', level: 'info', text: 'npm ci: added 1,204 packages in 8.1s' },
  ];
  if (deploy.state === 'Failed')
    return [
      ...lines,
      { time: '12:04:49.610', level: 'error', text: 'src/db/pool.ts(14,3): Property "idleTimeout" does not exist on type PoolConfig' },
      { time: '12:04:49.612', level: 'error', text: 'Build failed: tsc exited with code 2' },
    ];
  return [
    ...lines,
    { time: '12:04:58.512', level: 'warn', text: 'punycode is deprecated; use a userland alternative' },
    { time: '12:05:09.884', level: 'info', text: '312 tests passed in 11.5s' },
    { time: '12:05:22.016', level: 'info', text: deploy.state === 'Building' ? 'Pushing layer 3 of 7' : 'Live in 3 regions' },
  ];
}

export default function Deployments() {
  const [deploys, setDeploys] = useState(DEPLOYS);
  const [env, setEnv] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('d3');
  const [live, setLive] = useState('d4');
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const rows = deploys.filter(
    (deploy) =>
      (env === 'all' || deploy.env === env) &&
      (deploy.hash + ' ' + deploy.branch + ' ' + deploy.message).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const deploy = deploys.find((each) => each.id === selected) ?? deploys[0];
  const serving = deploys.find((each) => each.id === live) ?? deploys[0];
  const canRollBack = deploy.env === 'production' && deploy.state === 'Ready' && deploy.id !== live;
  const tab = (value: string, label: string) => ({ value, label, content: null });
  const build = (source: Deploy, target: string) => {
    const next = { ...source, id: 'd' + (deploys.length + 1), env: target, author: 'You', when: 'Just now', took: '0s', state: 'Building' };
    setDeploys([next, ...deploys]);
    setSelected(next.id);
    setNotice('Building ' + source.hash + ' from ' + source.branch + ' for ' + target + '.');
  };
  const rollBack = () => {
    if (typed !== 'ledger-api') {
      setError('Type ledger-api exactly to confirm.');
      return;
    }
    setLive(deploy.id);
    setNotice('Production now serves ' + deploy.hash + '. The previous build stays warm for an hour.');
    setConfirming(false);
    setTyped('');
    setError('');
  };

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-[color:var(--ds-canvas)] p-6">
      <header className="flex items-center gap-2">
        <div className="flex flex-col">
          <span className="ds-caption ds-text-muted">northwind / ledger-api</span>
          <h1 className="ds-heading">Deployments</h1>
        </div>
        <Button className="ml-auto" onClick={() => build(DEPLOYS[0], 'production')}>
          <Rocket size={16} aria-hidden="true" />
          Deploy main
        </Button>
      </header>
      <div className="flex items-end gap-3">
        <div className="-mb-4">
          <Tabs
            label="Environment"
            value={env}
            onValueChange={setEnv}
            items={[tab('all', 'All'), tab('production', 'Production'), tab('preview', 'Preview')]}
          />
        </div>
        <div className="ml-auto w-72">
          <Input label="Filter" placeholder="Commit, branch or message" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-[400px_1fr] items-start gap-4">
        <Card className="flex flex-col gap-0.5 !p-2">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="ds-body-strong m-0">No deployments match</p>
              <p className="ds-caption ds-text-muted m-0">Search by a short commit hash, a branch or words from the message.</p>
              <Button variant="secondary" onClick={() => setQuery('')}>
                Clear filter
              </Button>
            </div>
          ) : (
            rows.map((each) => (
              <button
                key={each.id}
                type="button"
                className="ds-row"
                aria-current={each.id === selected ? 'true' : undefined}
                onClick={() => setSelected(each.id)}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="ds-label truncate">{each.message}</span>
                  <span className="ds-caption ds-text-muted flex items-center gap-2">
                    <span className="ds-tabular">{each.hash}</span>
                    <GitBranch size={12} aria-hidden="true" />
                    {each.branch}
                  </span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className={STATE[each.state]} data-state={each.state === 'Building' ? 'running' : undefined}>
                    {each.state}
                  </span>
                  <span className="ds-caption ds-text-muted">{each.id === live ? 'Live' : each.when}</span>
                </div>
              </button>
            ))
          )}
        </Card>
        <Card className="flex min-w-0 flex-col gap-4 !p-5">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="ds-subheading">{deploy.message}</h2>
              <span className="ds-caption ds-text-muted flex items-center gap-2">
                <span className="ds-tabular">{deploy.hash}</span>
                {deploy.author + ' · ' + deploy.env + ' · built in ' + deploy.took}
                {deploy.id === live ? <Badge>Live</Badge> : null}
              </span>
            </div>
            {deploy.state === 'Failed' ? (
              <Button variant="secondary" className="ml-auto" onClick={() => build(deploy, deploy.env)}>
                <RotateCcw size={16} aria-hidden="true" />
                Retry build
              </Button>
            ) : (
              <Button variant="secondary" className="ml-auto" disabled={!canRollBack} onClick={() => setConfirming(true)}>
                <RotateCcw size={16} aria-hidden="true" />
                Roll back to this
              </Button>
            )}
          </div>
          <div className="ds-codeblock ds-log">
            {logFor(deploy).map((line) => (
              <Fragment key={line.time + line.text}>
                <span className="ds-text-muted">{line.time}</span>
                <span className={LEVEL[line.level]}>{line.level}</span>
                <span className={line.level === 'error' ? 'text-[color:var(--ds-danger)]' : 'ds-text-secondary'}>{line.text}</span>
              </Fragment>
            ))}
          </div>
          <p className="ds-caption ds-text-muted m-0" aria-live="polite">
            {notice || (canRollBack ? 'Rolling back swaps traffic in under a second; no rebuild.' : 'Only a ready production build can take traffic back.')}
          </p>
        </Card>
      </div>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title="Roll back production">
        <div className="flex flex-col gap-4">
          <p className="ds-body m-0">
            Traffic moves from <span className="ds-body-strong ds-tabular">{serving.hash}</span> to{' '}
            <span className="ds-body-strong ds-tabular">{deploy.hash}</span>. Requests
            in flight finish on the current build.
          </p>
          <Input
            label="Type ledger-api to confirm"
            value={typed}
            error={error}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
          />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="quiet" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button onClick={rollBack}>Roll back</Button>
        </div>
      </Dialog>
    </main>
  );
}
`;

export const API_KEYS_TSX = `import { useState } from 'react';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import { Badge, Button, Card, Dialog, Input, Tabs } from '@droidex/design-system';

const KEYS = [
  { id: 'key_3b81d0', name: 'Billing worker', env: 'live', prefix: 'nw_live_…9f2c', scopes: ['transfers:write', 'ledger:read'], created: '4 Feb 2025', used: '2 min ago' },
  { id: 'key_a4c7e2', name: 'Reporting export', env: 'live', prefix: 'nw_live_…41ad', scopes: ['ledger:read'], created: '19 Dec 2024', used: 'Yesterday' },
  { id: 'key_70f95b', name: 'Old cron (2023)', env: 'live', prefix: 'nw_live_…07be', scopes: ['transfers:write'], created: '2 Jun 2023', used: '94 days ago' },
];

function randomHex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const SYNTAX: Record<string, string> = {
  comment: 'ds-syntax-comment',
  keyword: 'ds-syntax-keyword',
  fn: 'ds-syntax-function',
  string: 'ds-syntax-string',
  number: 'ds-syntax-number',
  plain: 'ds-text-secondary',
};

const SNIPPET = [
  [['comment', '// Create a transfer with a live key']],
  [['keyword', 'const '], ['plain', 'transfer = '], ['keyword', 'await '], ['plain', 'northwind.transfers.'], ['fn', 'create'], ['plain', '({']],
  [['plain', '  amount: '], ['number', '1250'], ['plain', ',']],
  [['plain', '  currency: '], ['string', "'eur'"], ['plain', ',']],
  [['plain', '  idempotencyKey: '], ['string', "'order-8812'"], ['plain', ',']],
  [['plain', '});']],
];

export default function ApiKeys() {
  const [env, setEnv] = useState('live');
  const [keys, setKeys] = useState(KEYS);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');
  const [copy, setCopy] = useState('');
  const close = () => {
    setCreating(false);
    setCreated('');
    setName('');
    setError('');
    setCopy('');
  };
  const create = () => {
    if (name.trim() === '') {
      setError('Name the key after what uses it, like "Billing worker".');
      return;
    }
    const secret = 'nw_' + env + '_' + randomHex(14);
    setKeys([{ id: 'key_' + randomHex(3), name: name.trim(), env, prefix: 'nw_' + env + '_…' + secret.slice(-4), scopes: ['ledger:read'], created: 'Just now', used: 'Never' }, ...keys]);
    setCreated(secret);
  };
  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(created);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };
  const shown = keys.filter((key) => key.env === env);
  const tab = (value: string, label: string) => ({ value, label, content: null });

  return (
    <main className="flex min-h-screen flex-col gap-5 bg-[color:var(--ds-canvas)] p-6">
      <header className="flex items-start gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="ds-heading">API keys</h1>
          <p className="ds-body ds-text-muted m-0">A key acts as your workspace. Keep it in a secret manager, never in source.</p>
        </div>
        <Button className="ml-auto" onClick={() => setCreating(true)}>
          <Plus size={16} aria-hidden="true" />
          Create key
        </Button>
      </header>
      <div className="-mb-4">
        <Tabs label="Environment" value={env} onValueChange={setEnv} items={[tab('live', 'Live'), tab('test', 'Test')]} />
      </div>
      <Card className="flex flex-col !p-2">
        {shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <KeyRound size={20} aria-hidden="true" className="text-[color:var(--ds-fg-muted)]" />
            <p className="ds-body-strong m-0">No test keys yet</p>
            <p className="ds-caption ds-text-muted m-0">Test keys reach the sandbox and never move real money.</p>
            <Button variant="secondary" onClick={() => setCreating(true)}>
              Create a test key
            </Button>
          </div>
        ) : (
          shown.map((key) => (
            <div key={key.id} className="ds-row">
              <div className="flex w-48 flex-col gap-0.5">
                <span className="ds-label">{key.name}</span>
                <span className="ds-caption ds-text-muted">{'Created ' + key.created}</span>
              </div>
              <span className="ds-caption ds-tabular ds-text-muted w-40">{key.prefix}</span>
              <span className="flex flex-1 flex-wrap gap-1">
                {key.scopes.map((scope) => (
                  <Badge key={scope}>{scope}</Badge>
                ))}
              </span>
              <span className="ds-caption ds-text-muted w-28 text-right">{key.used}</span>
              <Button variant="quiet" onClick={() => setKeys(keys.filter((each) => each.id !== key.id))}>
                Revoke
              </Button>
            </div>
          ))
        )}
      </Card>
      <section className="flex flex-col gap-2">
        <span className="ds-overline ds-text-muted">Use it</span>
        <pre className="ds-codeblock">
          {SNIPPET.map((line, index) => (
            <div key={index}>
              {line.map(([kind, text], part) => (
                <span key={part} className={SYNTAX[kind]}>
                  {text}
                </span>
              ))}
            </div>
          ))}
        </pre>
      </section>
      <Dialog open={creating} onClose={close} title={created ? 'Copy your key' : 'Create a ' + env + ' key'}>
        {created ? (
          <div className="flex flex-col gap-3">
            <p className="ds-body m-0">This is the only time the full key is shown. Store it before you close this dialog.</p>
            <div className="flex items-center gap-2">
              <code className="ds-codeblock flex-1 select-all">{created}</code>
              <Button variant="secondary" onClick={copyKey}>
                {copy === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copy === 'copied' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            {copy === 'failed' ? (
              <p className="ds-caption m-0 text-[color:var(--ds-danger)]" role="alert">
                This page can't reach the clipboard. Select the key and copy it yourself.
              </p>
            ) : null}
            <div className="mt-3 flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <Input
              label="Name"
              placeholder="Billing worker"
              hint="Shown in audit logs next to every request the key makes."
              value={name}
              error={error}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="quiet" onClick={close}>
                Cancel
              </Button>
              <Button onClick={create}>Create key</Button>
            </div>
          </>
        )}
      </Dialog>
    </main>
  );
}
`;
