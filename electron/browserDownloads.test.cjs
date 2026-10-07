const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createBrowserDownloads, reserveDownloadPath } = require('./browserDownloads.cjs');

test('download paths are sanitized and reserved across concurrent downloads', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'droidex-download-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reserved = new Set();

  const first = reserveDownloadPath(directory, 'report<>:"/\\|?*.pdf. ', reserved);
  const second = reserveDownloadPath(directory, path.basename(first), reserved);

  assert.equal(path.dirname(first), directory);
  assert.doesNotMatch(path.basename(first), /[<>:"/\\|?*]|[. ]$/);
  assert.notEqual(first, second);
  assert.match(path.basename(second), / 2\.pdf$/);
});

test('download reservations collide case-insensitively', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'droidex-download-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reserved = new Set();

  reserveDownloadPath(directory, 'Report.pdf', reserved);
  const second = reserveDownloadPath(directory, 'report.pdf', reserved);

  assert.equal(path.basename(second), 'report 2.pdf');
});

test('download filenames stay within the UTF-8 component limit with a collision suffix', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'droidex-download-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reserved = new Set();
  const filename = `${'🚀'.repeat(100)}.txt`;

  const firstName = path.basename(reserveDownloadPath(directory, filename, reserved));
  const secondName = path.basename(reserveDownloadPath(directory, filename, reserved));

  assert.ok(Buffer.byteLength(firstName, 'utf8') <= 255);
  assert.ok(Buffer.byteLength(secondName, 'utf8') <= 255);
  assert.equal(Buffer.from(firstName, 'utf8').toString('utf8'), firstName);
  assert.match(secondName, / 2\.txt$/);

  const longExtension = path.basename(
    reserveDownloadPath(directory, `${'a'.repeat(239)}.${'b'.repeat(300)}`, reserved),
  );
  assert.doesNotMatch(longExtension, /[. ]$/);
});

test('download reservations collide across Unicode normalization forms', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'droidex-download-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const reserved = new Set();

  reserveDownloadPath(directory, 'café.pdf'.normalize('NFC'), reserved);
  const second = reserveDownloadPath(directory, 'café.pdf'.normalize('NFD'), reserved);

  assert.match(path.basename(second), / 2\.pdf$/);
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
        ? { browserSessionId: 'browser', agentActive: overrides.agentActive ?? true }
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
      if (['completed', 'cancelled', 'blocked', 'failed', 'interrupted'].includes(payload.state)) {
        terminal.get(payload.downloadId)?.resolve(payload);
      }
    },
  });
  t.after(async () => {
    await controller.cancelAll();
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
    const finished = events.find(
      (event) => event.downloadId === id && ['blocked', 'failed'].includes(event.state),
    );
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

test('agent downloads wait for in-app approval and denial never publishes a file', async (t) => {
  const { start, prompts, downloadDirectory, controller, directory } = fixture(t);
  const { item, completion } = start({
    url: 'https://user:secret@files.test/report.pdf?token=secret',
  });
  assert.equal(item.paused, true);
  assert.equal(item.resumed, false);
  assert.equal(fs.existsSync(downloadDirectory), false);
  assert.match(prompts[0].prompt.message, /report.pdf/);
  assert.equal(prompts[0].prompt.detail, 'Origin: https://files.test\nSize: 6 bytes');
  prompts[0].answer.resolve({ response: 1 });
  assert.equal((await completion).state, 'cancelled');
  assert.equal(item.cancelled, true);
  await controller.cancelAll();
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('agent executable downloads are blocked by filename, MIME type and redirect URL', async (t) => {
  const { start, prompts, events } = fixture(t);
  for (const candidate of [
    { filename: 'installer.EXE. ' },
    { filename: 'setup.dmg' },
    { filename: 'run.command' },
    { mimeType: 'application/x-executable; charset=binary' },
    { urls: ['https://files.test/setup.%65xe', 'https://files.test/report.pdf'] },
  ]) {
    const { item, prevented, completion } = start(candidate);
    assert.equal(prevented, true);
    assert.equal((await completion).state, 'blocked');
    assert.equal(item.savePath, undefined);
  }
  assert.equal(prompts.length, 0);
  assert.ok(events.every((event) => event.error === 'Agents cannot download executable files.'));
});

test('approved concurrent downloads use unique paths and send progress and completion data', async (t) => {
  const { start, prompts, events, downloadDirectory } = fixture(t);
  const first = start();
  const second = start();
  prompts.forEach(({ answer }) => answer.resolve({ response: 0 }));
  await new Promise(setImmediate);
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

test('user downloads use the save picker without agent approval or executable restrictions', async (t) => {
  const { start, choices, prompts, downloadDirectory } = fixture(t, {
    agentActive: false,
    settings: { askDownloadLocation: true },
  });
  const { item, completion } = start({ filename: 'setup.dmg' });
  assert.equal(prompts.length, 0);
  assert.equal(item.resumed, false);
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
  const first = approval.start({ size: 0 });
  assert.match(approval.prompts[0].prompt.detail, /Size: unknown/);
  approval.release();
  approval.prompts[0].answer.resolve({ response: 0 });
  assert.equal((await first.completion).state, 'cancelled');
  assert.equal(first.item.resumed, false);

  const picker = fixture(t, { agentActive: false, settings: { askDownloadLocation: true } });
  const second = picker.start();
  picker.release();
  assert.equal((await second.completion).state, 'cancelled');
  picker.choices[0].answer.resolve({
    canceled: false,
    filePath: path.join(picker.directory, 'late.pdf'),
  });
  await picker.controller.cancelAll();
  assert.equal(second.item.resumed, false);
  assert.equal(fs.existsSync(path.join(picker.directory, 'late.pdf')), false);
});

test('save failures are reported without a fallback dialog and release staging files', async (t) => {
  const { start, directory, choices, controller, events } = fixture(t, { agentActive: false });
  t.mock.method(fs, 'mkdirSync', () => {
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  });
  const { item } = start();
  await controller.cancelAll();
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
