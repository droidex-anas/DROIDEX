import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { QuestionCard } from './AskUserInline.js';
import type { SessionQuestion } from '../types/bridge.js';

function makeQuestion(questions: SessionQuestion['questions']): SessionQuestion {
  return { appSessionId: 'app-1', requestId: 'req-1', questions };
}

function renderCard(question: SessionQuestion): string {
  return renderToStaticMarkup(
    createElement(QuestionCard, {
      question,
      onAnswer: () => undefined,
      onCancel: () => undefined,
    }),
  );
}

const SINGLE = makeQuestion([
  {
    index: 0,
    question: 'Which database should I use?',
    options: [{ label: 'SQLite' }, { label: 'Postgres' }],
  },
]);

test('a single question offers unselected toggles, a custom answer, and a disabled Submit', () => {
  const html = renderCard(SINGLE);

  assert.match(html, /Which database should I use\?/);
  assert.match(html, />SQLite</);
  assert.match(html, />Postgres</);
  assert.match(html, /Type your own answer/);
  // Options are toggle buttons and start unselected.
  assert.ok(!html.includes('aria-pressed="true"'));
  assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, 2);
  // Submit stays disabled until an answer exists.
  assert.match(html, /<button[^>]*disabled=""[^>]*>Submit</);
  // A single question hides the step counter and Back.
  assert.ok(!html.includes(' of '));
  assert.ok(!html.includes('>Back</button>'));
});

test('multiple questions show progress and a Next action', () => {
  const html = renderCard(
    makeQuestion([
      { index: 0, question: 'First?', options: [{ label: 'a' }] },
      { index: 1, question: 'Second?', options: [{ label: 'b' }] },
    ]),
  );

  // Adjacent text expressions render with SSR comment separators.
  assert.match(html, /1(?:<!-- -->)? of (?:<!-- -->)?2/);
  assert.match(html, />Next</);
  // Next stays disabled until the first question is answered.
  assert.match(html, /<button[^>]*disabled=""[^>]*>Next</);
});

test('a header names the question and options carry their descriptions', () => {
  const html = renderCard(
    makeQuestion([
      {
        index: 0,
        question: 'Which database should I use?',
        header: 'Database',
        options: [
          { label: 'SQLite', description: 'One file, no server' },
          { label: 'Postgres', description: 'Runs alongside the app' },
        ],
      },
    ]),
  );

  assert.match(html, />Database</);
  assert.match(html, />One file, no server</);
  assert.match(html, />Runs alongside the app</);
});
