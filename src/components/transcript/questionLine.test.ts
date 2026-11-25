import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TranscriptEvent } from '../../types/bridge';
import { QuestionLine } from './questionLine';

function askEvent(toolName: string, toolArgs: unknown): TranscriptEvent {
  return {
    id: 'e1',
    appSessionId: 's',
    sourceSessionId: 's',
    role: 'primary',
    ts: 0,
    kind: 'tool_call',
    toolName,
    toolArgs,
  };
}

const DROID_ASK = askEvent('AskUser', {
  questionnaire:
    '1. [question] Which language?\n[topic] Language\n[option] Go\n[option] Rust\n\n2. [question] Which database?\n[topic] Database\n[option] SQLite',
});

function render(props: Parameters<typeof QuestionLine>[0]): string {
  return renderToStaticMarkup(createElement(QuestionLine, props));
}

test('a Droid answer lists each question over its answer, never the raw questionnaire', () => {
  const html = render({
    event: DROID_ASK,
    output:
      '1. [question] Which language?\n[answer] Go\n\n2. [question] Which database?\n[answer] SQLite (Recommended)',
  });
  assert.match(html, />Answered</);
  assert.match(html, />2 questions</);
  assert.match(html, /<dt[^>]*>Which language\?<\/dt><dd[^>]*>Go<\/dd>/);
  assert.match(html, /<dt[^>]*>Which database\?<\/dt><dd[^>]*>SQLite<\/dd>/);
  assert.ok(!html.includes('[question]') && !html.includes('questionnaire'));
});

test('a Claude answer reads the same from its answered line', () => {
  const html = render({
    event: askEvent('AskUserQuestion', { questions: [{ question: 'Which language?' }] }),
    output:
      'User has answered your questions: "Which language?"="Go". You can now continue with the user\'s answers in mind.',
  });
  assert.match(html, />1 question</);
  assert.match(html, /<dt[^>]*>Which language\?<\/dt><dd[^>]*>Go<\/dd>/);
});

test('a dismissed question is one line, not an error', () => {
  const html = render({
    event: DROID_ASK,
    output: 'Error: Tool execution cancelled by user',
    error: true,
  });
  assert.match(html, />Dismissed</);
  assert.match(html, />2 questions</);
  assert.ok(!html.includes('cancelled by user'));
  assert.ok(!html.includes('aria-expanded'));
});

test('a question still waiting shimmers its verb', () => {
  const html = render({ event: DROID_ASK, running: true });
  assert.match(html, /shimmer-text[^>]*>Asking</);
});
