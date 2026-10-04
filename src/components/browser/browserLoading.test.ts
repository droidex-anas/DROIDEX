import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldResetBrowserLoading } from './browserLoading';

test('browser loading resets on an app or established session change, not on first allocation', () => {
  assert.equal(
    shouldResetBrowserLoading(
      { browserKey: 'session-a', browserSessionId: undefined },
      { browserKey: 'session-a', browserSessionId: 'browser-a' },
    ),
    false,
  );
  assert.equal(
    shouldResetBrowserLoading(
      { browserKey: 'session-a', browserSessionId: 'browser-a' },
      { browserKey: 'session-b', browserSessionId: 'browser-b' },
    ),
    true,
  );
  assert.equal(
    shouldResetBrowserLoading(
      { browserKey: 'session-a', browserSessionId: 'browser-a' },
      { browserKey: 'session-a', browserSessionId: 'browser-b' },
    ),
    true,
  );
});
