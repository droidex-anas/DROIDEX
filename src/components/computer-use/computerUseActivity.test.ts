import assert from 'node:assert/strict';
import test from 'node:test';
import type { TranscriptEvent } from '../../types/bridge';
import { computerUseActivity } from './computerUseActivity';

function event(id: string, extra: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    id,
    appSessionId: 'app',
    sourceSessionId: 'primary',
    role: 'primary',
    ts: 0,
    kind: 'text',
    ...extra,
  };
}

function call(id: string, toolName = 'mcp__cua_repl__js'): TranscriptEvent {
  return event(id, { kind: 'tool_call', toolUseId: id, toolName });
}

function result(id: string, image: string, extra: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return event(`result-${id}`, { kind: 'tool_result', toolUseId: id, images: [image], ...extra });
}

test('screenshots stay within a turn and a steer keeps the current surface', () => {
  const events = [
    event('prompt-1', { author: 'user' }),
    call('old-call'),
    result('old-call', '/old.png'),
    event('prompt-2', { author: 'user' }),
  ];
  assert.equal(computerUseActivity(events), null);
  events.push(call('current-call'));
  assert.deepEqual(computerUseActivity(events), { kind: 'computer', turnId: 'prompt-2' });
  events.push(
    result('current-call', '/current.png'),
    event('steer', { author: 'user', steered: true }),
  );
  assert.deepEqual(computerUseActivity(events), {
    kind: 'computer',
    turnId: 'prompt-2',
    image: '/current.png',
  });
});

test('a screenshot requires a successful associated computer call, regardless of replay order', () => {
  const events = [
    event('prompt', { author: 'user' }),
    result('computer-call', '/screenshot.png'),
    call('computer-call'),
    call('image-read', 'view_image'),
    result('image-read', '/file.png'),
    call('image-generation', 'image_generation'),
    result('image-generation', '/generated.png'),
    call('search', 'web.search_query'),
    result('search', '/search.png'),
    result('unmatched', '/unmatched.png'),
    result('', '/idless.png'),
    result('computer-call', '/failed.png', { isError: true }),
    result('computer-call', '/interrupted.png', { interrupted: true }),
  ];
  assert.deepEqual(computerUseActivity(events), {
    kind: 'computer',
    turnId: 'prompt',
    image: '/screenshot.png',
  });
});

test('parent and child surfaces cannot borrow each other’s calls or screenshots', () => {
  const child = { role: 'worker' as const, sourceSessionId: 'child' };
  const events = [
    event('parent-prompt', { author: 'user' }),
    event('child-prompt', { author: 'user', ...child }),
    { ...call('shared-id'), ...child },
    result('shared-id', '/child.png', child),
    call('shared-id', 'mcp__droidex-browser__browser_open'),
    result('shared-id', '/parent.png'),
  ];
  assert.deepEqual(computerUseActivity(events), {
    kind: 'browser',
    turnId: 'parent-prompt',
  });
  assert.deepEqual(computerUseActivity(events, 'child'), {
    kind: 'computer',
    turnId: 'child-prompt',
    image: '/child.png',
  });
  assert.equal(computerUseActivity(events, 'other-child'), null);
});

test('the latest relevant call selects the surface and retains the computer frame between calls', () => {
  const events = [
    event('prompt', { author: 'user' }),
    call('browser-first', 'droidex-browser___browser_open'),
    call('computer-call'),
    call('unrelated', 'view_image'),
    result('unrelated', '/unrelated.png'),
  ];
  assert.deepEqual(computerUseActivity(events), { kind: 'computer', turnId: 'prompt' });
  events.push(result('computer-call', '/computer.png'));
  assert.deepEqual(computerUseActivity(events), {
    kind: 'computer',
    turnId: 'prompt',
    image: '/computer.png',
  });
  events.push(call('computer-next'));
  assert.deepEqual(computerUseActivity(events), {
    kind: 'computer',
    turnId: 'prompt',
    image: '/computer.png',
  });
  events.push(call('browser-next', 'mcp__droidex-browser__browser_click'));
  assert.deepEqual(computerUseActivity(events), {
    kind: 'browser',
    turnId: 'prompt',
  });
});

test('direct and forwarded CUA calls are recognized without treating arbitrary executor images as screenshots', () => {
  const cases: { name: string; args?: unknown; isComputer: boolean }[] = [
    { name: 'mcp__cua-repl__js', isComputer: true },
    { name: 'mcp__cua_repl__js_reset', isComputer: false },
    {
      name: 'functions.exec',
      args: 'const result = await tools.mcp__cua_repl__js({code: "await tab.cua.click({x:1,y:2})"});',
      isComputer: true,
    },
    {
      name: 'mcp__functions__exec',
      args: { code: 'await cua.createBrowserTab("iab", "https://example.com");' },
      isComputer: true,
    },
    {
      name: 'functions.exec',
      args: 'image(await tools.view_image({path:"/computer.png"}));',
      isComputer: false,
    },
    {
      name: 'functions.exec',
      args: { code: 'text("computer browser screenshot");' },
      isComputer: false,
    },
    { name: 'other_tool', args: { code: 'await cua.getApp("Example");' }, isComputer: false },
  ];
  for (const fixture of cases) {
    const activity = computerUseActivity([
      event('prompt', { author: 'user' }),
      { ...call('call', fixture.name), toolArgs: fixture.args },
      result('call', '/image.png'),
    ]);
    assert.deepEqual(
      activity,
      fixture.isComputer ? { kind: 'computer', turnId: 'prompt', image: '/image.png' } : null,
      fixture.name,
    );
  }
});

test('a named CUA function output starts the preview with its screenshot without a separate call row', () => {
  const events = [
    event('prompt', { author: 'user' }),
    result('cua-output', '/screen.png', { toolName: 'mcp__cua-repl__js' }),
    result('unrelated-executor', '/file.png', { toolName: 'mcp__functions__exec' }),
    result('failed-cua', '/failed.png', { toolName: 'mcp__cua-repl__js', isError: true }),
  ];
  assert.deepEqual(computerUseActivity(events), {
    kind: 'computer',
    turnId: 'prompt',
    image: '/screen.png',
  });
});
