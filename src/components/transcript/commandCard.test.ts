import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommandLine } from './commandCard';
import { LiveProcessesContext } from './liveProcessesContext';
import { renderToolEvents } from './rows';
import type { TranscriptEvent } from '@droidex/protocol';

test('running command rows display live call output until the final result arrives', () => {
  const call: TranscriptEvent = {
    id: 'call',
    appSessionId: 's',
    sourceSessionId: 's',
    role: 'primary',
    ts: 0,
    kind: 'tool_call',
    toolUseId: 'shell',
    toolName: 'shell',
    toolArgs: { command: 'printf hello' },
    text: 'Live terminal output',
  };
  const render = (events: TranscriptEvent[], detailed: boolean) =>
    renderToStaticMarkup(createElement('div', null, ...renderToolEvents(events, true, detailed)));
  assert.match(render([call], true), /Live terminal output/);
  const result: TranscriptEvent = {
    ...call,
    id: 'result',
    kind: 'tool_result',
    text: 'Final output',
  };
  const finished = render([call, result], true);
  assert.match(finished, /Final output/);
  assert.doesNotMatch(finished, /Live terminal output/);
  assert.match(render([call], false), /aria-expanded="false"/);
});

test('a live descendant keeps its originating command expandable with captured output', () => {
  const render = (command: string) =>
    renderToStaticMarkup(
      createElement(
        LiveProcessesContext.Provider,
        {
          value: [
            {
              pid: 123,
              name: 'vite',
              command: 'node vite.js',
              originCommand: '/bin/zsh -c npm run dev',
              startedAt: 1,
              ports: [5173],
            },
          ],
        },
        createElement(CommandLine, { command, output: 'Server ready', forceOpen: true }),
      ),
    );
  const html = render('npm run dev');
  assert.match(html, /<button[^>]+aria-expanded="true"/);
  assert.match(html, />Running</);
  assert.match(html, /Server ready/);
  assert.doesNotMatch(render('npm run de'), />Running</);
});
