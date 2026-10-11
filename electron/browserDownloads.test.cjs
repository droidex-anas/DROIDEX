const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createBrowserDownloads } = require('./browserDownloads.cjs');

test('download paths are sanitized and reserved across concurrent downloads', async (t) => {
  const { start, downloadDirectory } = fixture(t);
  const first = start({ filename: 'report<>:"/\\|?*.pdf. ' });
  const second = start({ filename: path.basename(first.item.savePath) });
  first.item.complete();
  second.item.complete();
  const [savedFirst, savedSecond] = await Promise.all([first.completion, second.completion]);

  assert.equal(path.dirname(savedFirst.filePath), downloadDirectory);
  assert.doesNotMatch(path.basename(savedFirst.filePath), /[<>:"/\\|?*]|[. ]$/);
  assert.notEqual(savedFirst.filePath, savedSecond.filePath);
  assert.match(path.basename(savedSecond.filePath), / 2\.pdf$/);
});

test('download reservations collide case-insensitively', async (t) => {
  const { start } = fixture(t);
  const first = start({ filename: 'Report.pdf' });
  const second = start({ filename: 'report.pdf' });
  first.item.complete();
  second.item.complete();
  const [, savedSecond] = await Promise.all([first.completion, second.completion]);
  assert.equal(path.basename(savedSecond.filePath), 'report 2.pdf');
});

test('download filenames stay within the UTF-8 component limit with a collision suffix', async (t) => {
  const { start } = fixture(t);
  const filename = `${'🚀'.repeat(100)}.txt`;
  const first = start({ filename });
  const second = start({ filename });
  const long = start({ filename: `${'a'.repeat(239)}.${'b'.repeat(300)}` });
  first.item.complete();
  second.item.complete();
  long.item.complete();
  const saved = await Promise.all([first.completion, second.completion, long.completion]);
  const [firstName, secondName, longExtension] = saved.map(({ filePath }) =>
    path.basename(filePath),
  );

  assert.ok(Buffer.byteLength(firstName, 'utf8') <= 255);
  assert.ok(Buffer.byteLength(secondName, 'utf8') <= 255);
  assert.equal(Buffer.from(firstName, 'utf8').toString('utf8'), firstName);
  assert.match(secondName, / 2\.txt$/);
  assert.doesNotMatch(longExtension, /[. ]$/);
});

test('download reservations collide across Unicode normalization forms', async (t) => {
  const { start } = fixture(t);
  const first = start({ filename: 'café.pdf'.normalize('NFC') });
  const second = start({ filename: 'café.pdf'.normalize('NFD') });
  first.item.complete();
  second.item.complete();
  const [, savedSecond] = await Promise.all([first.completion, second.completion]);
  assert.match(path.basename(savedSecond.filePath), / 2\.pdf$/);
});

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'droidex-download-test-'));
  const downloadDirectory = path.join(directory, 'Downloads');
  const contents = new EventEmitter();
  const prompts = [];
  const choices = [];
  const events = [];
  const terminal = new Map();
  let current = true;
  const controller = createBrowserDownloads({
    getSettings: () => ({ askDownloadLocation: false, downloadDirectory, ...overrides.settings }),
    getContext: (sender) =>
      current && sender === contents
        ? { browserSessionId: 'browser', working: overrides.working ?? true }
        : undefined,
    showPrompt: (prompt, options) => {
      const answer = Promise.withResolvers();
      options.signal.addEventListener(
        'abort',
        () => answer.resolve({ response: 1, cancelled: true }),
        { once: true },
      );
      prompts.push({ prompt, options, answer });
      return answer.promise;
    },
    showSaveDialog: (options) => {
      const answer = Promise.withResolvers();
      choices.push({ options, answer });
      return answer.promise;
    },
    tempPath: directory,
    sendToRenderer: (channel, payload) => {
      events.push({ channel, ...payload });
      if (['completed', 'cancelled', 'failed'].includes(payload.state)) {
        terminal.get(payload.downloadId)?.resolve(payload);
      }
    },
  });
  t.after(async () => {
    await controller.shutdown();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function start(
    {
      filename = 'report.pdf',
      mimeType = 'application/pdf',
      url = 'https://files.test/report.pdf',
      urls = [url],
      size = 6,
    } = {},
    sender = contents,
  ) {
    const item = new EventEmitter();
    Object.assign(item, {
      received: 0,
      total: size,
      resumed: false,
      cancelled: false,
      paused: false,
      getFilename: () => filename,
      getMimeType: () => mimeType,
      getURL: () => url,
      getURLChain: () => urls,
      getTotalBytes: () => item.total,
      getReceivedBytes: () => item.received,
      setSavePath: (value) => {
        item.savePath = value;
      },
      pause: () => {
        item.paused = true;
      },
      resume: () => {
        item.resumed = true;
      },
      cancel: () => {
        item.cancelled = true;
        item.emit('done', {}, 'cancelled');
      },
      complete: () => {
        fs.writeFileSync(item.savePath, 'report');
        item.received = 6;
        item.emit('updated', {}, 'progressing');
        item.emit('done', {}, 'completed');
        item.getReceivedBytes = () => assert.fail('DownloadItem used after done');
        item.getTotalBytes = () => assert.fail('DownloadItem used after done');
      },
    });
    let prevented = false;
    controller.handleWillDownload(
      {
        preventDefault: () => {
          prevented = true;
        },
      },
      item,
      sender,
    );
    const id = events.at(-1)?.downloadId;
    const completion = Promise.withResolvers();
    terminal.set(id, completion);
    const finished = events.find((event) => event.downloadId === id && event.state === 'failed');
    if (finished) completion.resolve(finished);
    return { item, completion: completion.promise, prevented };
  }
  return {
    controller,
    start,
    prompts,
    choices,
    events,
    contents,
    directory,
    downloadDirectory,
    release: () => {
      current = false;
      controller.cancelPendingForContents(contents);
    },
  };
}

test('executable downloads wait for in-app approval and denial never publishes a file', async (t) => {
  const { start, prompts, downloadDirectory, controller, directory } = fixture(t);
  const { item, completion } = start({
    filename: 'setup.exe',
    url: 'https://user:secret@files.test/setup.exe?token=secret',
  });
  assert.equal(item.paused, true);
  assert.equal(item.resumed, false);
  assert.equal(fs.existsSync(downloadDirectory), false);
  assert.match(prompts[0].prompt.message, /setup.exe/);
  assert.equal(
    prompts[0].prompt.detail,
    'Site: https://files.test\nSize: 6 bytes\nAn agent is working on this page.',
  );
  prompts[0].answer.resolve({ response: 1 });
  assert.equal((await completion).state, 'cancelled');
  assert.equal(item.cancelled, true);
  await controller.shutdown();
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('executable and script filename, MIME and redirect classifications always require approval', async (t) => {
  const { start, prompts } = fixture(t, { working: false });
  for (const candidate of [
    { filename: 'installer.EXE. ' },
    { filename: 'setup.dmg' },
    { filename: 'run.command' },
    { filename: 'script.js', mimeType: 'text/plain' },
    { filename: 'script.cjs', mimeType: 'application/octet-stream' },
    { filename: 'script.mjs', mimeType: 'text/plain' },
    { filename: 'script.ps1' },
    { filename: 'script.sh' },
    { filename: 'script.py' },
    { mimeType: 'application/x-executable; charset=binary' },
    { urls: ['https://files.test/script.%63js', 'https://files.test/report.pdf'] },
  ]) {
    const count = prompts.length;
    const { item, prevented, completion } = start(candidate);
    assert.equal(prevented, false);
    assert.equal(prompts.length, count + 1);
    assert.equal(item.resumed, false);
    assert.doesNotMatch(prompts.at(-1).prompt.detail, /An agent/);
    prompts.at(-1).answer.resolve({ response: 1 });
    assert.equal((await completion).state, 'cancelled');
    assert.equal(item.cancelled, true);
  }
});

test('ordinary concurrent downloads use unique paths and send progress and completion data', async (t) => {
  const { start, prompts, events, downloadDirectory } = fixture(t);
  const first = start();
  const second = start();
  assert.equal(prompts.length, 0);
  assert.equal(first.item.resumed, true);
  assert.equal(second.item.resumed, true);
  // Another writer arrives after reservation; exclusive creation must retry.
  fs.writeFileSync(path.join(downloadDirectory, 'report.pdf'), 'existing');
  first.item.complete();
  second.item.complete();
  const completed = await Promise.all([first.completion, second.completion]);
  assert.notEqual(completed[0].filePath, completed[1].filePath);
  assert.equal(fs.readFileSync(path.join(downloadDirectory, 'report.pdf'), 'utf8'), 'existing');
  for (const event of completed) {
    assert.equal(event.state, 'completed');
    assert.equal(fs.readFileSync(event.filePath, 'utf8'), 'report');
    assert.equal(event.receivedBytes, 6);
    assert.equal(event.totalBytes, 6);
    assert.equal(event.browserSessionId, 'browser');
    assert.equal(event.origin, 'https://files.test');
  }
  assert.ok(events.some((event) => event.state === 'progressing' && event.receivedBytes === 6));
  assert.ok(events.every((event) => event.channel === 'native-browser-download'));
});

test('approved executable downloads use the save picker even when the tab is idle', async (t) => {
  const { start, choices, prompts, downloadDirectory } = fixture(t, {
    working: false,
    settings: { askDownloadLocation: true },
  });
  const { item, completion } = start({ filename: 'setup.dmg' });
  assert.equal(prompts.length, 1);
  assert.equal(choices.length, 0);
  assert.equal(item.resumed, false);
  prompts[0].answer.resolve({ response: 0 });
  await new Promise(setImmediate);
  assert.equal(choices[0].options.defaultPath, path.join(downloadDirectory, 'setup.dmg'));
  const chosen = path.join(downloadDirectory, 'chosen.dmg');
  fs.writeFileSync(chosen, 'previous');
  choices[0].answer.resolve({ canceled: false, filePath: chosen });
  await new Promise(setImmediate);
  item.complete();
  assert.equal((await completion).filePath, chosen);
  assert.equal(fs.readFileSync(chosen, 'utf8'), 'report');
});

test('guest replacement cancels pending downloads and ignores late approval and file choices', async (t) => {
  const approval = fixture(t);
  const first = approval.start({ filename: 'script.mjs', size: 0 });
  assert.match(approval.prompts[0].prompt.detail, /Size: unknown/);
  approval.release();
  approval.prompts[0].answer.resolve({ response: 0 });
  assert.equal((await first.completion).state, 'cancelled');
  assert.equal(first.item.resumed, false);

  const picker = fixture(t, { working: false, settings: { askDownloadLocation: true } });
  const second = picker.start();
  picker.release();
  assert.equal((await second.completion).state, 'cancelled');
  picker.choices[0].answer.resolve({
    canceled: false,
    filePath: path.join(picker.directory, 'late.pdf'),
  });
  await picker.controller.shutdown();
  assert.equal(second.item.resumed, false);
  assert.equal(fs.existsSync(path.join(picker.directory, 'late.pdf')), false);
});

test('save failures are reported without a fallback dialog and release staging files', async (t) => {
  const { start, directory, choices, controller, events } = fixture(t, { working: false });
  t.mock.method(fs, 'mkdirSync', () => {
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  });
  const { item } = start();
  await controller.shutdown();
  assert.equal(item.cancelled, true);
  assert.equal(choices.length, 0);
  assert.equal(events.at(-1).state, 'failed');
  assert.match(events.at(-1).error, /permissions/);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('downloads from an unowned webContents are rejected before any save or prompt', (t) => {
  const { start, prompts, choices, events } = fixture(t);
  const { item, prevented } = start({}, new EventEmitter());
  assert.equal(prevented, true);
  assert.equal(item.savePath, undefined);
  assert.equal(prompts.length, 0);
  assert.equal(choices.length, 0);
  assert.equal(events.length, 0);
});

test('exclusive creation advances past dangling symlink collisions', async (t) => {
  const { start, downloadDirectory } = fixture(t);
  const { item, completion } = start();
  const copy = fsp.copyFile;
  let attempts = 0;
  t.mock.method(fsp, 'copyFile', (...args) => {
    if (++attempts > 3) throw new Error('Download kept retrying colliding names.');
    return copy(...args);
  });
  const destination = path.join(downloadDirectory, 'report.pdf');
  fs.symlinkSync(path.join(downloadDirectory, 'missing'), destination);
  fs.symlinkSync(
    path.join(downloadDirectory, 'also-missing'),
    path.join(downloadDirectory, 'report 2.pdf'),
  );

  item.complete();
  const saved = await completion;
  assert.equal(saved.state, 'completed');
  assert.equal(path.basename(saved.filePath), 'report 3.pdf');
  assert.equal(fs.readFileSync(saved.filePath, 'utf8'), 'report');
  assert.equal(fs.lstatSync(destination).isSymbolicLink(), true);
});

test('shutdown rejects downloads arriving during cleanup and leaves nothing pending', async (t) => {
  const { start, controller, directory } = fixture(t);
  const cleaning = Promise.withResolvers();
  const releaseCleanup = Promise.withResolvers();
  const remove = fsp.rm;
  t.mock.method(fsp, 'rm', async (...args) => {
    cleaning.resolve();
    await releaseCleanup.promise;
    return remove(...args);
  });
  const first = start();
  const shutdown = controller.shutdown();
  await cleaning.promise;
  const late = start({ filename: 'script.cjs' });
  releaseCleanup.resolve();
  await shutdown;

  assert.equal((await first.completion).state, 'cancelled');
  assert.equal(first.item.cancelled, true);
  assert.equal(late.prevented, true);
  assert.equal(late.item.savePath, undefined);
  assert.equal(controller.hasPending(), false);
  assert.deepEqual(fs.readdirSync(directory), ['Downloads']);
  assert.equal(start().prevented, true);
});

test('updated and terminal interruptions report failures and release transfers', async (t) => {
  const { start, controller, events } = fixture(t);
  const updated = start();
  updated.item.emit('updated', {}, 'interrupted');
  const terminal = start();
  terminal.item.emit('done', {}, 'interrupted');

  for (const result of await Promise.all([updated.completion, terminal.completion])) {
    assert.equal(result.state, 'failed');
    assert.match(result.error, /interrupted.*Try downloading/);
  }
  assert.equal(updated.item.cancelled, true);
  await controller.shutdown();
  assert.equal(controller.hasPending(), false);
  assert.ok(events.every(({ state }) => state !== 'interrupted'));
});
