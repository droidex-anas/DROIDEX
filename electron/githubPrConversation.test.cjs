const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePrComments,
  normalizeReviewThreadPage,
  prComments,
} = require('./githubPrConversation.cjs');

const ghResult = (overrides = {}) => ({
  code: 0,
  stdout: '',
  stderr: '',
  spawnFailed: false,
  ...overrides,
});

const ghFailure = (stderr) => ghResult({ code: 1, stderr });

const threadsPayload = (reviewThreads) => ({
  data: { repository: { pullRequest: { reviewThreads } } },
});

/**
 * A gh runner answering the three PR conversation sources: `gh pr view`, the
 * review thread GraphQL query, and the inline comment REST pages. Each source is
 * a JSON value, raw stdout text, or a gh result.
 */
function ghSources({
  conversation = { comments: [], reviews: [] },
  threads = threadsPayload({ nodes: [] }),
  inline = [],
}) {
  const answer = (source) => {
    if (source && typeof source === 'object' && 'spawnFailed' in source) return source;
    return ghResult({ stdout: typeof source === 'string' ? source : JSON.stringify(source) });
  };
  return async (_dir, args) => {
    if (args[0] === 'pr') return answer(conversation);
    return answer(args[1] === 'graphql' ? threads : inline);
  };
}

const inlineRows = (ids) => [
  ids.map((id) => ({ id, user: { login: 'reviewer' }, body: `comment ${id}` })),
];

const unresolved = { resolved: false, outdated: false, resolvedBy: null };
const threadStatus = ({ resolved, outdated, resolvedBy }) => ({ resolved, outdated, resolvedBy });

const graphqlQuery = (args) => String(args.at(-1) || '');
const graphqlCursor = (args) => {
  const index = args.findIndex((arg) => String(arg).startsWith('cursor='));
  return index === -1 ? null : String(args[index]).slice('cursor='.length);
};

test('PR comments include top-level, review, and inline review threads', () => {
  const comments = normalizePrComments(
    {
      comments: [
        {
          databaseId: 10,
          author: { login: 'author' },
          body: 'Top-level **comment**',
          createdAt: '2026-08-04T10:00:00Z',
          url: 'https://example.test/comment/10',
          reactionGroups: [{ content: 'EYES', users: { totalCount: 2 } }],
        },
      ],
      reviews: [
        {
          id: 'review-20',
          author: { login: 'reviewer' },
          body: 'Changes requested',
          submittedAt: '2026-08-04T10:01:00Z',
          state: 'CHANGES_REQUESTED',
          reactionGroups: [{ content: 'THUMBS_UP', users: { totalCount: 1 } }],
        },
      ],
    },
    [
      {
        id: 30,
        user: { login: 'inline-reviewer' },
        body: 'Fix `scope` here',
        created_at: '2026-08-04T10:02:00Z',
        html_url: 'https://example.test/review/30',
        path: 'src/components/ReviewPanel.tsx',
        line: 42,
        diff_hunk: '@@ -40,2 +40,3 @@',
        reactions: { '+1': 3, heart: 1, total_count: 4 },
      },
    ],
  );

  assert.deepEqual(
    comments.map(({ kind, author, body, path, line, reactions }) => ({
      kind,
      author,
      body,
      path,
      line,
      reactions,
    })),
    [
      {
        kind: 'comment',
        author: 'author',
        body: 'Top-level **comment**',
        path: undefined,
        line: undefined,
        reactions: [{ content: 'EYES', count: 2 }],
      },
      {
        kind: 'review',
        author: 'reviewer',
        body: 'Changes requested',
        path: undefined,
        line: undefined,
        reactions: [{ content: 'THUMBS_UP', count: 1 }],
      },
      {
        kind: 'inline',
        author: 'inline-reviewer',
        body: 'Fix `scope` here',
        path: 'src/components/ReviewPanel.tsx',
        line: 42,
        reactions: [
          { content: 'THUMBS_UP', count: 3 },
          { content: 'HEART', count: 1 },
        ],
      },
    ],
  );
});

test('PR comments report malformed rows as partial while keeping valid rows', async () => {
  const result = await prComments(
    '/repo',
    { prNumber: 79 },
    ghSources({
      conversation: {
        comments: [null, { databaseId: 10, author: { login: 'author' }, body: 'top level' }],
        reviews: [{ databaseId: 20, author: { login: 'reviewer' }, body: 'review' }, 42],
      },
      inline: [[undefined, { id: 30, user: { login: 'inline-reviewer' }, body: 'inline' }]],
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.match(result.message, /1 malformed PR conversation comment/);
  assert.match(result.message, /1 malformed PR review/);
  assert.match(result.message, /1 malformed inline review comment/);
  assert.deepEqual(
    result.comments.map(({ kind, body }) => ({ kind, body })),
    [
      { kind: 'comment', body: 'top level' },
      { kind: 'review', body: 'review' },
      { kind: 'inline', body: 'inline' },
    ],
  );
});

test('a failed or malformed comment source is reported while the other source is kept', async () => {
  const conversation = {
    comments: [{ databaseId: 10, author: { login: 'author' }, body: 'comment 10' }],
    reviews: [],
  };
  const cases = [
    ['inline pagination fails', { conversation, inline: ghFailure('REST rate limited') }],
    [
      'conversation lookup fails',
      { conversation: ghFailure('GraphQL unavailable'), inline: inlineRows([30]) },
    ],
    ['conversation payload is malformed', { conversation: '{', inline: inlineRows([30]) }],
  ];
  const expected = [
    [/REST rate limited/, ['comment 10']],
    [/GraphQL unavailable/, ['comment 30']],
    [/Invalid PR conversation payload/, ['comment 30']],
  ];
  for (const [index, [label, sources]] of cases.entries()) {
    const result = await prComments('/repo', { prNumber: 79 }, ghSources(sources));
    const [message, bodies] = expected[index];
    assert.equal(result.ok, true, label);
    assert.equal(result.partial, true, label);
    assert.match(result.message, message, label);
    assert.deepEqual(
      result.comments.map((comment) => comment.body),
      bodies,
      label,
    );
  }
});

test('PR comments fail only when no comment source is usable', async () => {
  const bothFailed = await prComments('/repo', { prNumber: 79 }, async (_dir, args) =>
    ghFailure(`${args[0]} failed`),
  );
  assert.equal(bothFailed.ok, false);
  assert.equal(bothFailed.reason, 'gh_error');
  assert.deepEqual(bothFailed.comments, []);
  assert.match(bothFailed.message, /pr failed/);
  assert.match(bothFailed.message, /api failed/);

  const bothMalformed = await prComments(
    '/repo',
    { prNumber: 79 },
    ghSources({ conversation: '{', inline: '{}' }),
  );
  assert.equal(bothMalformed.ok, false);
  assert.equal(bothMalformed.reason, 'gh_error');
  assert.match(bothMalformed.message, /Invalid PR conversation payload/);
  assert.match(bothMalformed.message, /Invalid inline review comments payload/);
  assert.deepEqual(bothMalformed.comments, []);
});

test('inline comments carry the resolved verdict of their review thread', async () => {
  const threads = threadsPayload({
    nodes: [
      {
        isResolved: true,
        isOutdated: true,
        resolvedBy: { login: 'ana' },
        comments: { nodes: [{ databaseId: 30 }, { databaseId: 31 }] },
      },
      {
        isResolved: false,
        isOutdated: false,
        resolvedBy: null,
        comments: { nodes: [{ databaseId: 32 }] },
      },
    ],
  });
  const calls = [];
  const answer = ghSources({ threads, inline: inlineRows([30, 31, 32]) });
  const result = await prComments('/repo', { prNumber: 79 }, async (dir, args) => {
    calls.push(args);
    return answer(dir, args);
  });

  assert.equal(result.ok, true);
  assert.equal(result.partial, undefined);
  assert.deepEqual(result.comments.map(threadStatus), [
    { resolved: true, outdated: true, resolvedBy: 'ana' },
    { resolved: true, outdated: true, resolvedBy: 'ana' },
    unresolved,
  ]);
  const graphql = calls.find((args) => args[1] === 'graphql');
  assert.deepEqual(graphql.slice(2, 8), [
    '-F',
    'owner={owner}',
    '-F',
    'repo={repo}',
    '-F',
    'number=79',
  ]);
  assert.match(graphql.at(-1), /reviewThreads/);
});

test('a failed or malformed thread lookup leaves inline comments unresolved and says so', async () => {
  for (const [threads, message] of [
    [ghFailure('graphql rate limited\n'), /graphql rate limited/],
    ['{}', /Invalid review thread status payload/],
  ]) {
    const result = await prComments(
      '/repo',
      { prNumber: 79 },
      ghSources({ threads, inline: inlineRows([30]) }),
    );
    assert.equal(result.ok, true);
    assert.equal(result.partial, true);
    assert.match(result.message, message);
    assert.deepEqual(result.comments.map(threadStatus), [unresolved]);
  }
});

test('a failed thread lookup stays quiet when there are no inline comments', async () => {
  const result = await prComments(
    '/repo',
    { prNumber: 79 },
    ghSources({
      conversation: {
        comments: [{ databaseId: 10, author: { login: 'author' }, body: 'top level' }],
        reviews: [],
      },
      threads: ghFailure('graphql rate limited'),
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.partial, undefined);
  assert.equal(result.message, undefined);
});

test('review threads without comment ids are ignored instead of throwing', () => {
  const page = normalizeReviewThreadPage(
    threadsPayload({ nodes: [{ isResolved: true, comments: { nodes: [{}] } }, null] }),
  );
  assert.equal(page.statusByCommentId.size, 0);
  assert.deepEqual(page.pagedThreads, []);
  assert.equal(page.nextCursor, null);
  assert.equal(normalizeReviewThreadPage(null).statusByCommentId.size, 0);
});

test('review thread status follows both thread and reply pagination', async () => {
  const threadPages = {
    null: {
      pageInfo: { hasNextPage: true, endCursor: 'THREAD_CURSOR' },
      nodes: [
        {
          id: 'THREAD_A',
          isResolved: true,
          isOutdated: false,
          resolvedBy: { login: 'ana' },
          comments: {
            pageInfo: { hasNextPage: true, endCursor: 'REPLY_CURSOR' },
            nodes: [{ databaseId: 30 }],
          },
        },
      ],
    },
    THREAD_CURSOR: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: 'THREAD_B',
          isResolved: false,
          isOutdated: false,
          resolvedBy: null,
          comments: { pageInfo: { hasNextPage: false }, nodes: [{ databaseId: 32 }] },
        },
      ],
    },
  };
  const cursors = [];
  const inline = ghSources({ inline: inlineRows([30, 31, 32]) });
  const result = await prComments('/repo', { prNumber: 79 }, async (dir, args) => {
    if (args[1] !== 'graphql') return inline(dir, args);
    const cursor = graphqlCursor(args);
    if (/reviewThreads/.test(graphqlQuery(args))) {
      cursors.push(['threads', cursor]);
      return ghResult({ stdout: JSON.stringify(threadsPayload(threadPages[String(cursor)])) });
    }
    cursors.push(['replies', cursor]);
    assert.ok(args.includes('id=THREAD_A'));
    return ghResult({
      stdout: JSON.stringify({
        data: {
          node: { comments: { pageInfo: { hasNextPage: false }, nodes: [{ databaseId: 31 }] } },
        },
      }),
    });
  });

  assert.equal(result.ok, true);
  assert.equal(result.partial, undefined);
  assert.deepEqual(cursors, [
    ['threads', null],
    ['threads', 'THREAD_CURSOR'],
    ['replies', 'REPLY_CURSOR'],
  ]);
  assert.deepEqual(
    result.comments.map(({ body, resolved, resolvedBy }) => ({ body, resolved, resolvedBy })),
    [
      { body: 'comment 30', resolved: true, resolvedBy: 'ana' },
      { body: 'comment 31', resolved: true, resolvedBy: 'ana' },
      { body: 'comment 32', resolved: false, resolvedBy: null },
    ],
  );
});

test('an unbounded review thread list reports truncation instead of a wrong status', async () => {
  let threadPageCount = 0;
  const inline = ghSources({ inline: inlineRows([30]) });
  const result = await prComments('/repo', { prNumber: 79 }, async (dir, args) => {
    if (args[1] !== 'graphql') return inline(dir, args);
    threadPageCount += 1;
    const pageInfo = { hasNextPage: true, endCursor: `CURSOR_${threadPageCount}` };
    return ghResult({ stdout: JSON.stringify(threadsPayload({ pageInfo, nodes: [] })) });
  });

  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.match(result.message, /more review thread data than DROIDEX can load/);
  assert.equal(threadPageCount, 10);
});

test('malformed successful review thread replies payload is reported as partial', async () => {
  const thread = {
    id: 'THREAD_A',
    isResolved: true,
    comments: {
      pageInfo: { hasNextPage: true, endCursor: 'REPLY_CURSOR' },
      nodes: [{ databaseId: 30 }],
    },
  };
  const sources = ghSources({
    threads: threadsPayload({ nodes: [thread] }),
    inline: inlineRows([30, 31]),
  });
  const result = await prComments('/repo', { prNumber: 79 }, async (dir, args) =>
    args[1] === 'graphql' && !/reviewThreads/.test(graphqlQuery(args))
      ? ghResult({ stdout: '{}' })
      : sources(dir, args),
  );

  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.match(result.message, /Invalid review thread replies payload/);
  assert.deepEqual(
    result.comments.map(({ body, resolved }) => ({ body, resolved })),
    [
      { body: 'comment 30', resolved: true },
      { body: 'comment 31', resolved: false },
    ],
  );
});
