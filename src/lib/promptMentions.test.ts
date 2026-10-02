import test from 'node:test';
import assert from 'node:assert/strict';
import { composePrompt } from './composePrompt';
import { splitTrailingMentions, userMessageAttachments } from './promptMentions';

test('splitTrailingMentions recovers every file shape composePrompt appends', () => {
  // [prose, attached files]
  const cases: Array<[string, string[]]> = [
    ['look at this', ['/tmp/a.png', 'src/b.ts']],
    ['compare these', ['/tmp/Screen Shot 2026.png', '/tmp/b.png']],
    ['read this', ['README.md', 'logo.png']], // repo-root files with no directory
    ['open', ['/tmp/v2.5 final.png']], // first word looks like an extension
    ['open', ['Reports/Quarterly Q3']], // extensionless path with spaces
    ['read', ['C:\\repo\\My Docs\\LICENSE']], // Windows path, no extension
    ['summarise', ['Meeting Notes.pdf']], // bare file name with spaces
    ['', ['/tmp/a.png']], // a prompt that is only attachments
  ];
  for (const [text, files] of cases) {
    assert.deepEqual(splitTrailingMentions(composePrompt(text, [], files)), { text, files });
  }
});

test('splitTrailingMentions leaves prose with @words or trailing words as prose', () => {
  for (const text of [
    'ping @anas about this\n\nand also check the @ sign handling',
    'look\n\n@/tmp/a.png please review',
    'thanks\n\n@anas @cubic',
  ]) {
    assert.deepEqual(splitTrailingMentions(text), { text, files: [] });
  }
});

test('userMessageAttachments trusts live event metadata, even over attachment-shaped text', () => {
  assert.deepEqual(userMessageAttachments('look at this', ['/tmp/a.png']), {
    text: 'look at this',
    files: ['/tmp/a.png'],
  });
  const typed = 'nothing\n\n@/tmp/a.png';
  assert.deepEqual(userMessageAttachments(typed, []), { text: typed, files: [] });
});

test('userMessageAttachments parses a replayed message this app composed, keeping its skill', () => {
  const plain = composePrompt('what is wrong here', [], ['/tmp/paste-1.png']);
  assert.deepEqual(userMessageAttachments(plain, undefined), {
    text: 'what is wrong here',
    files: ['/tmp/paste-1.png'],
  });
  const withSkill = composePrompt('fix the bug', ['debugger'], ['/tmp/paste-1.png']);
  assert.deepEqual(userMessageAttachments(withSkill, undefined), {
    text: '/debugger fix the bug',
    files: ['/tmp/paste-1.png'],
  });
  // Mentions separated by newlines instead of the single spaces composePrompt
  // emits: not our format, so the text is left exactly as persisted.
  const foreign = 'see these\n\n@/tmp/a.png\n@/tmp/b.png';
  assert.deepEqual(userMessageAttachments(foreign, undefined), { text: foreign, files: [] });
});
