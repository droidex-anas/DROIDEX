import assert from 'node:assert/strict';
import test from 'node:test';
import { withLocalStorageMap } from '../test/localStorage';
import {
  archivedChats,
  archiveChat,
  chatDisplayTitle,
  deleteChat,
  isChatHidden,
  isChatPinned,
  loadChatMetadata,
  linkChatsPullRequest,
  MAX_CHAT_PULL_REQUESTS,
  MAX_CHAT_TITLE_LENGTH,
  pinChat,
  pinnedChats,
  pullRequestMatchesQuery,
  renameChat,
  restoreChat,
  saveChatMetadata,
  unpinChat,
  type ChatMetadataMap,
} from './chatMetadata';
import { sessionSummary } from '../test/sessionSummary';

/** Loads metadata from a stored payload: an object is JSON-encoded, a string is stored as is. */
function loadStored(payload: unknown): ChatMetadataMap {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let loaded: ChatMetadataMap = {};
  withLocalStorageMap({ 'droid-chat-metadata': raw }, () => {
    loaded = loadChatMetadata();
  });
  return loaded;
}

function pullRequest(number: number, title = 'PR') {
  return {
    number,
    url: `https://github.com/team/repo/pull/${number}`,
    title,
    state: 'OPEN',
    isDraft: false,
    headRefName: 'branch',
  };
}

const makeSession = (appSessionId: string, updatedAt = 1_000, title = appSessionId) =>
  sessionSummary(appSessionId, {
    title,
    autonomy: 'off',
    phase: 'completed',
    createdAt: updatedAt,
    updatedAt,
  });

test('renameChat sets, changes, clears, trims, and caps the display title, preserving other flags', () => {
  const renamed = renameChat({}, 's1', 'My chat');
  assert.deepEqual(renamed, { s1: { displayTitle: 'My chat' } });

  const changed = renameChat(renamed ?? {}, 's1', 'Better name');
  assert.deepEqual(changed, { s1: { displayTitle: 'Better name' } });

  // Re-renaming to the same title is a no-op; clearing when unset is too.
  assert.equal(renameChat(changed ?? {}, 's1', 'Better name'), null);
  assert.equal(renameChat({}, 's1', '   '), null);

  // A blank title clears the override (back to the generated title).
  assert.deepEqual(renameChat(changed ?? {}, 's1', '  '), {});

  const pinned = pinChat({}, 's1', 100) ?? {};
  assert.deepEqual(renameChat(pinned, 's1', '  padded  '), {
    s1: { pinnedAt: 100, displayTitle: 'padded' },
  });
  const long = renameChat({}, 's1', 'x'.repeat(MAX_CHAT_TITLE_LENGTH + 50));
  assert.equal(long?.s1.displayTitle?.length, MAX_CHAT_TITLE_LENGTH);
});

test('chatDisplayTitle prefers the override and humanizes commands and markdown for display only', () => {
  const session = makeSession('s1', 1_000, 'Generated title');
  assert.equal(chatDisplayTitle(session, undefined), 'Generated title');
  assert.equal(chatDisplayTitle(session, {}), 'Generated title');
  assert.equal(chatDisplayTitle(session, { displayTitle: 'My name' }), 'My name');
  assert.equal(
    chatDisplayTitle(makeSession('s4', 1_000, '/review'), { displayTitle: '/review' }),
    'Review',
  );

  // The CLI titles skill invocations by the raw command ("/review src"); the
  // sidebar shows the command as a name. Display-only: the stored title is
  // never rewritten, so the original string is always recoverable.
  const cases: Array<[stored: string, shown: string]> = [
    ['/review src/lib', 'Review: src/lib'],
    ['/btw side conversation (hidden)', 'Btw: side conversation (hidden)'],
    ['/ review', 'Review'],
    // Not bare commands: paths and ordinary titles pass through verbatim.
    ['/already/a/path', '/already/a/path'],
    ['see /review later', 'see /review later'],
    // Markdown titles show their rendered prose.
    ['### HI', 'HI'],
    ['**Fix** the `login` flow', 'Fix the login flow'],
    ['see [docs](https://example.com/a?b=1) now', 'see docs now'],
    // Underscores survive so snake_case names stay whole, and a title that is
    // nothing but syntax falls back to the raw string instead of an empty row.
    ['fix_login_flow', 'fix_login_flow'],
    ['#### ', '#### '],
  ];
  for (const [stored, shown] of cases) {
    assert.equal(chatDisplayTitle(makeSession('s', 1_000, stored), undefined), shown, stored);
  }
});

test('pinChat stamps pinnedAt and unpinChat removes the empty entry', () => {
  const pinned = pinChat({}, 's1', 100);
  assert.deepEqual(pinned, { s1: { pinnedAt: 100 } });

  // Re-pinning and unpinning an unpinned chat are no-ops (null).
  assert.equal(pinChat(pinned ?? {}, 's1', 200), null);
  assert.equal(unpinChat({}, 's1'), null);

  // Unpinning the only flag prunes the key entirely.
  assert.deepEqual(unpinChat(pinned ?? {}, 's1'), {});
});

test('archiveChat hides the chat, unpins it, and keeps the rename; restoreChat undoes it', () => {
  let map = pinChat({}, 's1', 100) ?? {};
  map = renameChat(map, 's1', 'Keep this name') ?? map;
  const archived = archiveChat(map, 's1', 500);
  assert.deepEqual(archived, { s1: { displayTitle: 'Keep this name', archivedAt: 500 } });

  const meta = (archived ?? {}).s1;
  assert.equal(isChatHidden(meta), true);
  assert.equal(isChatPinned(meta), false);

  // Archiving twice is a no-op; the original timestamp stands.
  assert.equal(archiveChat(archived ?? {}, 's1', 900), null);

  const restored = restoreChat(archiveChat({}, 's1', 500) ?? {}, 's1');
  assert.deepEqual(restored, {});
  assert.equal(restoreChat(restored ?? {}, 's1'), null);
});

test('deleteChat tombstones, stays archived, and clears a conflicting pin', () => {
  const archived = archiveChat({}, 's1', 500) ?? {};
  const deleted = deleteChat(archived, 's1', 900);
  assert.deepEqual(deleted, { s1: { archivedAt: 500, deletedAt: 900 } });
  assert.equal(isChatHidden((deleted ?? {}).s1), true);
  assert.equal(deleteChat(deleted ?? {}, 's1', 1000), null);

  // A deleted chat cannot be pinned.
  assert.equal(pinChat(deleteChat({}, 's1', 100) ?? {}, 's1', 200), null);

  // Deleting a pinned chat drops the pin.
  const pinned = pinChat({}, 's2', 100) ?? {};
  assert.deepEqual(deleteChat(pinned, 's2', 300), { s2: { deletedAt: 300 } });
});

test('pinned and archived lists skip hidden chats; archived lists newest first', () => {
  const sessions = [makeSession('a'), makeSession('b'), makeSession('c'), makeSession('d')];
  const pinnedMetadata: ChatMetadataMap = {
    a: { pinnedAt: 100 },
    b: { pinnedAt: 200, archivedAt: 300 },
    c: { pinnedAt: 400, deletedAt: 500 },
  };
  assert.deepEqual(
    pinnedChats(sessions, pinnedMetadata).map((s) => s.appSessionId),
    ['a'],
  );

  const archivedMetadata: ChatMetadataMap = {
    a: { archivedAt: 100 },
    b: { archivedAt: 300, deletedAt: 400 },
    c: { archivedAt: 200 },
  };
  const rows = archivedChats(sessions.slice(0, 3), archivedMetadata);
  assert.deepEqual(
    rows.map((row) => row.session.appSessionId),
    ['c', 'a'],
  );
  assert.equal(rows[0].archivedAt, 200);
});

test('chat metadata round-trips through localStorage and loads sanitize corrupt payloads', () => {
  withLocalStorageMap({}, () => {
    let map = renameChat({}, 's1', 'Renamed everywhere') ?? {};
    map = archiveChat(map, 's1', 200) ?? {};
    saveChatMetadata(map);
    assert.deepEqual(loadChatMetadata(), {
      s1: { displayTitle: 'Renamed everywhere', archivedAt: 200 },
    });
  });

  assert.deepEqual(
    loadStored({
      ok: { pinnedAt: 1, displayTitle: 'Nice chat' },
      blankTitle: { displayTitle: '   ' },
      wrongTitleType: { displayTitle: 42 },
      empty: {},
      junk: 'nope',
      badStamps: { pinnedAt: 'soon', archivedAt: null },
      partial: { deletedAt: 9, pinnedAt: null },
    }),
    {
      ok: { pinnedAt: 1, displayTitle: 'Nice chat' },
      partial: { deletedAt: 9 },
    },
  );
  assert.deepEqual(loadStored('not json{'), {});
  assert.deepEqual(loadStored('[1,2]'), {});
});

test('loadChatMetadata caps preferences without evicting hidden-chat tombstones', () => {
  const pins: Record<string, { pinnedAt: number }> = {};
  for (let i = 0; i < 1001; i += 1) pins[`s${String(i)}`] = { pinnedAt: i };
  const loaded = loadStored(pins);
  assert.equal(Object.keys(loaded).length, 1000);
  // Storage order is recency (writes reinsert the touched id last), so the
  // load cap drops the oldest entries — the same rule the write cap enforces.
  assert.equal(loaded.s0, undefined);
  assert.equal(loaded.s1.pinnedAt, 1);
  assert.equal(loaded.s1000.pinnedAt, 1000);

  // Same eviction rule as the write path: a restart must not resurrect hidden
  // chats from an oversized-at-rest payload either.
  const withTombstones: Record<string, Record<string, number>> = {
    // Inserted first, so these are the OLDEST entries — and tombstones.
    'old-archive': { archivedAt: 1 },
    'old-delete': { deletedAt: 2 },
  };
  for (let i = 0; i < 1000; i += 1) withTombstones[`s${String(i)}`] = { pinnedAt: i };
  const kept = loadStored(withTombstones);
  assert.equal(Object.keys(kept).length, 1002);
  assert.equal(kept.s0?.pinnedAt, 0);
  assert.equal(kept.s1?.pinnedAt, 1);
  assert.equal(kept['old-archive']?.archivedAt, 1);
  assert.equal(kept['old-delete']?.deletedAt, 2);

  const tombstones = Object.fromEntries(
    Array.from({ length: 1001 }, (_, index) => [`hidden-${index}`, { deletedAt: index }]),
  );
  assert.deepEqual(loadStored(tombstones), tombstones);
});

test('runtime updates cap preferences without evicting hidden-chat tombstones', () => {
  // The load-time cap alone left a gap: metadata created after startup grew
  // the map (and the stored payload) past the bound until the next restart.
  let map: ChatMetadataMap = {};
  for (let i = 0; i < 1000; i += 1) map = pinChat(map, `s${String(i)}`, i) ?? map;
  assert.equal(Object.keys(map).length, 1000);

  const next = pinChat(map, 's1000', 1000) ?? {};
  assert.equal(Object.keys(next).length, 1000);
  // The touched id is reinserted as most recent, so the oldest entry drops.
  assert.equal(next.s0, undefined);
  assert.equal(next.s1?.pinnedAt, 1);
  assert.equal(next.s1000?.pinnedAt, 1000);

  // Updating an existing id reorders instead of growing, so it survives too.
  const renamed = renameChat(next, 's1', 'still here') ?? {};
  assert.equal(Object.keys(renamed).length, 1000);
  assert.equal(renamed.s1?.displayTitle, 'still here');

  // Forgetting a pin or rename is harmless; forgetting an archived/deleted
  // tombstone would resurface a chat the user explicitly hid.
  // Tombstones do not consume the visible-preference budget.
  map = archiveChat(map, 'hidden-1', 2000) ?? {};
  map = deleteChat(map, 'hidden-2', 2001) ?? {};
  assert.equal(Object.keys(map).length, 1002);
  assert.equal(map.s0?.pinnedAt, 0);
  assert.equal(map.s1?.pinnedAt, 1);
  assert.equal(map['hidden-1']?.archivedAt, 2000);
  assert.equal(map['hidden-2']?.deletedAt, 2001);

  const tombstones: ChatMetadataMap = Object.fromEntries(
    Array.from({ length: 1001 }, (_, index) => [`hidden-${index}`, { deletedAt: index }]),
  );
  const archived = archiveChat(tombstones, 'old-archive', 2003);
  assert.ok(archived);
  assert.equal(Object.keys(archived).length, 1002);
  assert.deepEqual(archived['hidden-0'], tombstones['hidden-0']);
  assert.equal(archived['old-archive']?.archivedAt, 2003);

  const organized = pinChat(
    renameChat(archived, 'visible', 'Still visible') ?? {},
    'visible',
    2004,
  );
  assert.ok(organized);
  assert.deepEqual(organized.visible, { displayTitle: 'Still visible', pinnedAt: 2004 });
  assert.deepEqual(loadStored(organized), organized);

  // One more preference entry still evicts a pin, never the tombstones.
  map = pinChat(map, 's1001', 2002) ?? {};
  assert.equal(Object.keys(map).length, 1002);
  assert.equal(map.s0, undefined);
  assert.equal(map.s1?.pinnedAt, 1);
  assert.equal(map['hidden-1']?.archivedAt, 2000);
  assert.equal(map['hidden-2']?.deletedAt, 2001);
});

test('automatic PR discovery preserves names and pins and does not churn a full cache', () => {
  const pr = { ...pullRequest(42, 'Sidebar'), headRefName: 'sidebar' };
  const original: ChatMetadataMap = {
    important: { displayTitle: 'Keep this name', pinnedAt: 1 },
    hidden: { deletedAt: 2 },
  };
  const ids = Array.from({ length: 1100 }, (_, index) => `chat-${String(index)}`);
  const linked = linkChatsPullRequest(original, ids, pr);
  assert.ok(linked);
  assert.equal(Object.keys(linked).length, 1001);
  assert.deepEqual(linked.important, original.important);
  assert.equal(linkChatsPullRequest(linked, ids, pr), null);
  const renamed = renameChat(linked, 'another', 'Explicit name');
  assert.ok(renamed);
  assert.deepEqual(renamed.important, original.important);
  assert.equal(renamed.another.displayTitle, 'Explicit name');
  assert.equal(Object.keys(renamed).length, 1001);
});

test('PR history and titles stay bounded at runtime and on reload, deduplicating stored links', () => {
  let map: ChatMetadataMap = {};
  for (let number = 1; number <= 20; number++) {
    map = linkChatsPullRequest(map, ['chat'], pullRequest(number, 'x'.repeat(500))) ?? map;
  }
  assert.equal(map.chat.pullRequests?.length, MAX_CHAT_PULL_REQUESTS);
  assert.equal(map.chat.pullRequests?.[0].number, 20);
  assert.equal(map.chat.pullRequests?.[0].title.length, 200);
  withLocalStorageMap({}, () => {
    saveChatMetadata(map);
    assert.deepEqual(loadChatMetadata(), map);
  });
  const matching = map.chat.pullRequests?.filter((pr) => pullRequestMatchesQuery(pr, '#19'));
  assert.deepEqual(
    matching?.map((pr) => pr.number),
    [19],
  );

  const stored = Array.from({ length: 30 }, (_, i) => pullRequest(i + 1, 'x'.repeat(500)));
  const links = loadStored({ chat: { pullRequests: [stored[0], ...stored] } }).chat.pullRequests;
  assert.equal(links?.length, MAX_CHAT_PULL_REQUESTS);
  assert.equal(links?.[0].title.length, 200);
  assert.equal(new Set(links?.map((pr) => pr.url)).size, MAX_CHAT_PULL_REQUESTS);
});

test('opening a chat can replace passive PR metadata at capacity without evicting user organization', () => {
  const pr = pullRequest(1);
  const full: ChatMetadataMap = { pinned: { pinnedAt: 1 }, hidden: { deletedAt: 2 } };
  for (let i = 0; i < 999; i++) full[`cached-${i}`] = { pullRequests: [pr] };
  assert.equal(linkChatsPullRequest(full, ['active'], pr), null);
  const next = linkChatsPullRequest(full, ['active'], pr, 'active');
  assert.ok(next);
  assert.equal(Object.keys(next).length, 1001);
  assert.deepEqual(next.active.pullRequests, [pr]);
  assert.deepEqual(next.pinned, full.pinned);
  assert.deepEqual(next.hidden, full.hidden);
  assert.equal(next['cached-0'], undefined);
});
