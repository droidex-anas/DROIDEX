import assert from 'node:assert/strict';
import test from 'node:test';
import { menuMatchRank, rankMenuCandidates } from './composerMenuRanking';

interface Skill {
  name: string;
  description?: string;
}

const identity = (skill: Skill) => skill;

const names = (items: Skill[]) => items.map((item) => item.name);

test('an exactly named skill leads results that only mention the query', () => {
  const skills: Skill[] = [
    { name: 'autoresearch', description: 'Research a topic and review the sources' },
    { name: 'create-pr', description: 'Open a pull request for review' },
    { name: 'review', description: 'Review code changes' },
    { name: 'security-review', description: 'Audit a repository' },
  ];
  const ranked = rankMenuCandidates('review', skills, identity);
  assert.deepEqual(names(ranked.items), ['review', 'security-review', 'create-pr', 'autoresearch']);
  assert.equal(ranked.bestRank, 0);
});

test('a name prefix outranks a name substring, which outranks a description hit', () => {
  const skills: Skill[] = [
    { name: 'zzz', description: 'talks about commit' },
    { name: 'pre-commit-hooks', description: 'unrelated' },
    { name: 'commit-security-scan', description: 'unrelated' },
    { name: 'deploy', description: 'ship it' },
    { name: 'com' },
  ];
  assert.deepEqual(names(rankMenuCandidates('commit', skills, identity).items), [
    'commit-security-scan',
    'pre-commit-hooks',
    'zzz',
  ]);
  assert.ok(
    menuMatchRank('review', { name: 'security-review' }) <
      menuMatchRank('review', { name: 'prereviewer' }),
  );
});

test('an empty query keeps catalog order and bestRank lets the caller pick the leading group', () => {
  const catalog: Skill[] = [{ name: 'visualize' }, { name: 'bug' }, { name: 'model' }];
  const unfiltered = rankMenuCandidates('', catalog, identity);
  assert.deepEqual(names(unfiltered.items), ['visualize', 'bug', 'model']);
  assert.equal(unfiltered.bestRank, 3);

  const commands: Skill[] = [{ name: 'settings', description: 'review your preferences' }];
  assert.ok(
    rankMenuCandidates('review', [{ name: 'review' }], identity).bestRank <
      rankMenuCandidates('review', commands, identity).bestRank,
  );
});
