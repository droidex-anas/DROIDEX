import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionRow, areSessionRowPropsEqual, type SessionRowProps } from './SidebarSessionRow';
import type { SessionSummary } from '../types/bridge';

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    appSessionId: 'sess-a',
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Build the thing',
    goal: '',
    cwd: '',
    autonomy: 'off',
    phase: 'completed',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function makeProps(overrides: Partial<SessionRowProps> = {}): SessionRowProps {
  return {
    session: makeSession(),
    title: 'Build the thing',
    active: false,
    unread: false,
    running: false,
    agentsWorking: false,
    attention: null,
    activityStatus: 'ready',
    renaming: false,
    now: 5_000,
    onSelect: () => undefined,
    onMenu: () => undefined,
    onRenameCommit: () => undefined,
    onRenameCancel: () => undefined,
    ...overrides,
  };
}

const render = (props: SessionRowProps) => renderToStaticMarkup(createElement(SessionRow, props));

// Stable callbacks shared across prop pairs so only the tested field differs.
const STABLE = {
  onSelect: () => undefined,
  onMenu: () => undefined,
  onRenameCommit: () => undefined,
  onRenameCancel: () => undefined,
};

test('areSessionRowPropsEqual ignores unrelated session updates', () => {
  const prev = makeProps({ session: makeSession(), ...STABLE });
  const next = makeProps({
    session: makeSession({ contextTokens: 500, tokensIn: 200, tokensOut: 300 }),
    ...STABLE,
  });
  assert.equal(areSessionRowPropsEqual(prev, next), true);
  // The harness title is not row-visible (the resolved `title` prop is), so a
  // title-only summary change must not re-render the row.
  const retitled = makeProps({ session: makeSession({ title: 'New generated' }), ...STABLE });
  assert.equal(areSessionRowPropsEqual(prev, retitled), true);
});

test('areSessionRowPropsEqual detects every row-visible prop change', () => {
  const props = makeProps({ ...STABLE });
  const changes: [Partial<SessionRowProps>, Partial<SessionRowProps>][] = [
    [{}, { session: makeSession({ appSessionId: 'sess-b' }) }],
    [{}, { session: makeSession({ updatedAt: 2_000 }) }],
    [{}, { session: makeSession({ reasoningEffort: 'ultra' }) }],
    [{ title: 'Old' }, { title: 'New' }],
    [{ active: false }, { active: true }],
    [{ unread: false }, { unread: true }],
    [{ running: false }, { running: true }],
    [{ attention: null }, { attention: 'approval' }],
    [{ now: 5_000 }, { now: 35_000 }],
    [{ renaming: false }, { renaming: true }],
    [{ agentsWorking: false }, { agentsWorking: true }],
    // A new callback identity must reach the row, or it would call a stale handler.
    [{}, { onMenu: () => undefined }],
  ];
  for (const [before, after] of changes) {
    assert.equal(
      areSessionRowPropsEqual({ ...props, ...before }, { ...props, ...after }),
      false,
      Object.keys(after).join(),
    );
  }
});

test('SessionRow renders the display title, its actions button, and targets the row by appSessionId', () => {
  const html = render(
    makeProps({
      session: makeSession({ appSessionId: 'sess-a', title: 'Generated' }),
      title: 'Renamed',
    }),
  );
  assert.match(html, /Renamed/);
  assert.doesNotMatch(html, /Generated/);
  assert.match(html, /data-app-session-id="sess-a"/);
  assert.match(render(makeProps()), /aria-label="Actions for Build the thing"/);
});

test('SessionRow in rename mode renders an inline editor instead of the row', () => {
  const html = render(makeProps({ renaming: true, title: 'Old name' }));
  assert.match(html, /aria-label="Rename Old name"/);
  assert.match(html, /value="Old name"/);
  assert.doesNotMatch(html, /data-testid="session-row"/);
});

test('SessionRow: the active row exposes aria-current, an unread row exposes a hidden label', () => {
  assert.match(render(makeProps({ active: true })), /aria-current="true"/);
  assert.doesNotMatch(render(makeProps({ active: false })), /aria-current/);
  assert.match(render(makeProps({ unread: true })), /sr-only">Unread:</);
  assert.doesNotMatch(render(makeProps({ unread: false })), /Unread:/);
});

test('SessionRow: a running row leads with the library spinner; running or idle, it keeps the time', () => {
  const html = render(makeProps({ running: true, now: 60_000 }));
  // motion-safe keeps the spinner still for reduced-motion users.
  assert.match(html, /data-icon="spinner"/);
  assert.match(html, /motion-safe:animate-spin-slow/);
  assert.match(html, /aria-label="working"/);
  assert.match(html, /transition-colors duration-300/);
  assert.doesNotMatch(html, /droid-ultra/);
  assert.match(html, />now</);

  // An idle row keeps the relative timestamp without a spinner.
  const idle = render(makeProps({ running: false, now: 60_000 }));
  assert.doesNotMatch(idle, /animate-spin/);
  assert.match(idle, />now</);
});

test('SessionRow: an ultracode session spins in the ultra colour with the effort shimmer', () => {
  // Its main agent can idle while its agents work, so the mark has to say more
  // than "running", and it must say so in the harness's own word, not colour alone.
  const html = render(
    makeProps({
      running: true,
      session: makeSession({ provider: 'claude', reasoningEffort: 'ultra' }),
    }),
  );
  assert.match(html, /transition-colors duration-300 text-droid-ultra/);
  assert.match(html, /effort-dot-ultra/);
  assert.match(html, /aria-label="working on ultracode"/);

  const high = render(
    makeProps({ running: true, session: makeSession({ reasoningEffort: 'high' }) }),
  );
  assert.doesNotMatch(high, /droid-ultra/);
  assert.match(high, /aria-label="working"/);
});

test('SessionRow: a sleeping chat whose agents work keeps the ultra mark', () => {
  // The main agent idles through a wave and wakes when it finishes, so the row
  // has to stay alive without claiming the chat's own turn is running.
  const html = render(makeProps({ running: false, agentsWorking: true, now: 60_000 }));
  assert.match(html, /motion-safe:animate-spin-slow/);
  assert.match(html, /transition-colors duration-300 text-droid-ultra/);
  assert.match(html, /effort-dot-ultra/);
  assert.match(html, /aria-label="agents working"/);

  // Its own turn back in flight is the chat working, not its agents.
  const live = render(makeProps({ running: true, agentsWorking: true }));
  assert.match(live, /aria-label="working"/);
});

test('SessionRow: idle list rows lead with the linked PR, not a status glyph', () => {
  const html = render(
    makeProps({
      session: makeSession({ provider: 'codex' }),
      activityStatus: 'failed',
      pr: { kind: 'open', checks: 'fail' },
    }),
  );
  const pr = html.indexOf('aria-label="Open, checks failing"');
  const harness = html.indexOf('aria-label="Codex chat"');
  assert.ok(pr >= 0 && harness > pr);
  assert.doesNotMatch(html, /aria-label="Failed"/);
});

test('SessionRow: a working list row spins and reveals its PR on hover', () => {
  const html = render(makeProps({ running: true, pr: { kind: 'open', checks: 'pending' } }));
  const spinner = html.indexOf('aria-label="working"');
  const pr = html.indexOf('aria-label="Open, checks running"');
  assert.ok(spinner >= 0 && pr > spinner);
  assert.match(html, /opacity-0 transition-opacity group-hover:opacity-100/);
});

test('SessionRow: inbox rows name the harness and show the reason beside the time', () => {
  const html = render(makeProps({ detail: 'Ready to start', activityStatus: 'plan', now: 60_000 }));
  assert.match(html, /aria-label="Droid chat"/);
  assert.match(html, />Ready to start</);
  assert.match(html, />now</);
});

test('SessionRow: a working inbox row shimmers its activity instead of the time', () => {
  const html = render(
    makeProps({ detail: 'Editing files', activityStatus: 'working', running: true, now: 60_000 }),
  );
  assert.match(html, /shimmer-text">Editing files</);
  assert.doesNotMatch(html, />now</);
});

test('SessionRow: a blocked running row shows its waiting status instead of the spinner', () => {
  const html = render(
    makeProps({ running: true, attention: 'approval', activityStatus: 'approval', now: 60_000 }),
  );
  assert.match(html, /aria-label="Needs approval"/);
  assert.doesNotMatch(html, /animate-spin/);
});

test('activity status changes invalidate the row memo and expose readable status text', () => {
  // Inbox rows (with a detail line) are the ones that draw a status glyph.
  const props = makeProps({ ...STABLE, detail: 'Finished' });
  assert.equal(areSessionRowPropsEqual(props, { ...props }), true);
  for (const activityStatus of ['review', 'failed'] as const) {
    const next = { ...props, activityStatus };
    assert.equal(areSessionRowPropsEqual(props, next), false);
    const label = activityStatus === 'review' ? 'Needs review' : 'Failed';
    const html = render(next);
    assert.ok(html.includes(`title="Build the thing · ${label}"`));
    assert.ok(html.includes(`aria-label="${label}"`));
  }
});
