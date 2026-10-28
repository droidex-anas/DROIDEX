import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TranscriptEvent } from '../../types/bridge';
import { SkillCard } from './skillCard';

const SKILL_EVENT: TranscriptEvent = {
  id: 'e1',
  appSessionId: 's',
  sourceSessionId: 's',
  role: 'primary',
  ts: 0,
  kind: 'tool_call',
  toolName: 'Skill',
  toolArgs: { skill: 'review', args: 'src/auth' },
};

test('a skill invocation reads as the rosette, its name and its ask', () => {
  const html = renderToStaticMarkup(
    createElement(SkillCard, { event: SKILL_EVENT, output: 'Reviewed src/auth.' }),
  );
  assert.match(html, /data-icon="rosette"/);
  assert.match(html, /text-skill[^>]*>review</);
  assert.match(html, />src\/auth</);
});

test('the body shows what the skill answered, never the raw JSON arguments', () => {
  const html = renderToStaticMarkup(
    createElement(SkillCard, { event: SKILL_EVENT, output: 'Reviewed src/auth.', forceOpen: true }),
  );
  assert.match(html, /Reviewed src\/auth\./);
  assert.ok(!html.includes('"skill"') && !html.includes('&quot;skill&quot;'));
});

test('an in-flight skill shimmers its verb', () => {
  const html = renderToStaticMarkup(
    createElement(SkillCard, { event: SKILL_EVENT, running: true }),
  );
  assert.match(html, /shimmer-text[^>]*>Skill</);
});
