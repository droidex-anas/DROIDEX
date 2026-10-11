const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

const MAX_FILENAME_BYTES = 240;

function sanitizeDownloadFilename(filename) {
  const sanitizedName =
    path
      .basename(String(filename || 'download'))
      // eslint-disable-next-line no-control-regex -- Download filenames must sanitize control bytes.
      .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
      .replace(/[. ]+$/g, '') || 'download';
  return (
    truncateFilenameUtf8(sanitizedName, MAX_FILENAME_BYTES).replace(/[. ]+$/g, '') || 'download'
  );
}

function reserveDownloadPath(directory, download, reservedPaths) {
  const extension = path.extname(download.filename);
  const stem = path.basename(download.filename, extension);
  for (;;) {
    const index = download.nextFilenameIndex++;
    const name = index === 1 ? download.filename : `${stem} ${index}${extension}`;
    const candidate = path.join(directory, name);
    const key = downloadReservationKey(candidate);
    if (fs.existsSync(candidate) || reservedPaths.has(key)) continue;
    reservedPaths.add(key);
    download.reservation = candidate;
    return candidate;
  }
}

function downloadReservationKey(filePath) {
  return path.normalize(filePath).normalize('NFD').toLowerCase();
}

function truncateFilenameUtf8(filename, maxBytes) {
  const extension = path.extname(filename);
  const extensionBytes = Buffer.byteLength(extension, 'utf8');
  if (!extension || extensionBytes >= maxBytes) return truncateUtf8(filename, maxBytes);
  const stem = path.basename(filename, extension);
  return `${truncateUtf8(stem, maxBytes - extensionBytes)}${extension}`;
}

function truncateUtf8(value, maxBytes) {
  let bytes = 0;
  let result = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

// Executables and scripts require explicit approval regardless of who starts them.
const EXECUTABLE_EXTENSIONS = new Set([
  '.exe',
  '.msi',
  '.msp',
  '.com',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.vbe',
  '.js',
  '.cjs',
  '.mjs',
  '.jse',
  '.wsf',
  '.wsh',
  '.scr',
  '.pif',
  '.hta',
  '.lnk',
  '.app',
  '.dmg',
  '.pkg',
  '.mpkg',
  '.sh',
  '.bash',
  '.zsh',
  '.command',
  '.py',
  '.pl',
  '.rb',
  '.scpt',
  '.applescript',
  '.run',
  '.bin',
  '.deb',
  '.rpm',
  '.appimage',
  '.jar',
  '.desktop',
]);
const EXECUTABLE_MIME_TYPES = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-msi',
  'application/vnd.microsoft.portable-executable',
  'application/x-executable',
  'application/x-sharedlib',
  'application/x-mach-binary',
  'application/x-apple-diskimage',
  'application/x-sh',
  'application/x-shellscript',
  'application/java-archive',
  'application/javascript',
  'text/javascript',
  'text/x-python',
  'application/x-python-code',
]);

function createBrowserDownloads({
  getSettings,
  getContext,
  showPrompt,
  showSaveDialog,
  tempPath,
  sendToRenderer,
}) {
  const downloads = new Set();
  const reservedPaths = new Set();
  let shuttingDown = false;

  function emit(download, state, fields = {}) {
    sendToRenderer('native-browser-download', {
      downloadId: download.id,
      browserSessionId: download.browserSessionId,
      filename: download.filename,
      origin: download.origin,
      receivedBytes: download.receivedBytes,
      totalBytes: download.totalBytes,
      state,
      ...fields,
    });
  }

  function handleWillDownload(event, item, contents) {
    if (shuttingDown) {
      event.preventDefault();
      return;
    }
    const context = contents && getContext(contents);
    if (!context) {
      event.preventDefault();
      return;
    }
    const filename = sanitizeDownloadFilename(item.getFilename());
    const download = {
      id: randomUUID(),
      item,
      contents,
      filename,
      browserSessionId: context.browserSessionId,
      origin: downloadOrigin(item.getURL()),
      working: context.working,
      requiresApproval: isExecutableDownload(item, filename),
      nextFilenameIndex: 1,
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      abort: new AbortController(),
      published: false,
      accepted: false,
    };
    try {
      // Electron requires setSavePath during this synchronous callback. Staging
      // preserves POST/blob downloads while approval and the file picker await.
      download.directory = fs.mkdtempSync(path.join(tempPath, 'droidex-download-'));
      item.setSavePath(path.join(download.directory, filename));
      item.pause();
    } catch {
      event.preventDefault();
      if (download.directory) fs.rmSync(download.directory, { recursive: true, force: true });
      emit(download, 'failed', {
        error: 'Cannot stage download. Check the temporary folder permissions.',
      });
      return;
    }
    downloads.add(download);
    download.finished = Promise.withResolvers();
    download.onDone = (_event, state) => {
      download.receivedBytes = item.getReceivedBytes();
      download.totalBytes = item.getTotalBytes();
      download.sourceFinished = true;
      if (state === 'interrupted') failInterrupted(download);
      download.finished.resolve(state);
    };
    download.onUpdated = (_event, state) => {
      download.receivedBytes = item.getReceivedBytes();
      download.totalBytes = item.getTotalBytes();
      if (download.abort.signal.aborted) return;
      if (state === 'interrupted') {
        failInterrupted(download);
        return;
      }
      if (download.accepted) emit(download, state);
    };
    item.once('done', download.onDone);
    item.on('updated', download.onUpdated);
    download.onDestroyed = () => {
      if (!download.accepted) cancel(download);
    };
    contents.once('destroyed', download.onDestroyed);
    download.task = receive(download);
  }

  function cancel(download) {
    if (download.abort.signal.aborted || download.published) return;
    download.abort.abort();
    if (!download.sourceFinished) download.item.cancel();
    download.finished.resolve('cancelled');
  }

  function failInterrupted(download) {
    download.failure = 'Download interrupted. Try downloading the file again.';
    cancel(download);
  }

  function requireCurrent(download) {
    download.abort.signal.throwIfAborted();
    if (getContext(download.contents)?.browserSessionId !== download.browserSessionId) {
      cancel(download);
      download.abort.signal.throwIfAborted();
    }
  }

  async function receive(download) {
    const { item, abort } = download;
    let savePath;
    let selectedStagingPath;
    try {
      if (download.requiresApproval) {
        emit(download, 'awaiting-approval');
        const size = download.totalBytes;
        const answer = await showPrompt(
          {
            kind: 'permission',
            title: 'Allow download?',
            message: `Download ${download.filename}?`,
            detail: `Site: ${download.origin}\n${size > 0 ? `Size: ${size.toLocaleString('en-US')} bytes` : 'Size: unknown'}${download.working ? '\nAn agent is working on this page.' : ''}`,
            buttons: ['Allow once', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
          },
          { signal: abort.signal },
        );
        requireCurrent(download);
        if (answer.cancelled || answer.response !== 0) {
          cancel(download);
          emit(download, 'cancelled');
          return;
        }
      }
      const settings = getSettings();
      fs.mkdirSync(settings.downloadDirectory, { recursive: true });
      if (settings.askDownloadLocation) {
        emit(download, 'awaiting-location');
        const cancelled = Promise.withResolvers();
        const onAbort = () => cancelled.reject(abort.signal.reason);
        abort.signal.addEventListener('abort', onAbort, { once: true });
        let result;
        try {
          result = await Promise.race([
            showSaveDialog({
              defaultPath: path.join(settings.downloadDirectory, download.filename),
            }),
            cancelled.promise,
          ]);
        } finally {
          abort.signal.removeEventListener('abort', onAbort);
        }
        requireCurrent(download);
        if (result.canceled || !result.filePath) {
          cancel(download);
          emit(download, 'cancelled');
          return;
        }
        savePath = result.filePath;
      } else {
        requireCurrent(download);
        savePath = reserveDownloadPath(settings.downloadDirectory, download, reservedPaths);
      }
      download.accepted = true;
      emit(download, 'progressing');
      if (!download.sourceFinished) item.resume();
      const state = await download.finished.promise;
      abort.signal.throwIfAborted();
      if (state !== 'completed') {
        emit(download, state);
        return;
      }
      const source = path.join(download.directory, download.filename);
      if (settings.askDownloadLocation) {
        // The file picker owns overwrite confirmation. Publish its choice
        // atomically, preserving an existing file if copying or cancellation fails.
        selectedStagingPath = path.join(path.dirname(savePath), `.droidex-download-${download.id}`);
        await fsp.copyFile(source, selectedStagingPath, fs.constants.COPYFILE_EXCL);
        abort.signal.throwIfAborted();
        fs.renameSync(selectedStagingPath, savePath);
        download.published = true;
        emit(download, 'completed', { filePath: savePath });
        return;
      }
      // Exclusive creation also catches a file created after the path was reserved.
      for (;;) {
        try {
          await fsp.copyFile(source, savePath, fs.constants.COPYFILE_EXCL);
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          reservedPaths.delete(downloadReservationKey(savePath));
          savePath = reserveDownloadPath(settings.downloadDirectory, download, reservedPaths);
        }
        abort.signal.throwIfAborted();
      }
      if (abort.signal.aborted) {
        await fsp.rm(savePath, { force: true });
        abort.signal.throwIfAborted();
      }
      download.published = true;
      emit(download, 'completed', { filePath: savePath });
    } catch (error) {
      const cancelled = abort.signal.aborted;
      cancel(download);
      if (download.failure) emit(download, 'failed', { error: download.failure });
      else if (cancelled) emit(download, 'cancelled');
      else {
        let message = 'Cannot save download. Choose a writable folder and try again.';
        if (error.code === 'EACCES' || error.code === 'EPERM')
          message = 'Cannot save download. Check the download folder permissions.';
        emit(download, 'failed', { error: message });
      }
    } finally {
      item.removeListener('updated', download.onUpdated);
      item.removeListener('done', download.onDone);
      download.contents.removeListener('destroyed', download.onDestroyed);
      if (download.reservation) reservedPaths.delete(downloadReservationKey(download.reservation));
      const stagingPaths = [download.directory, selectedStagingPath].filter(Boolean);
      const cleanup = await Promise.allSettled(
        stagingPaths.map((filePath) => fsp.rm(filePath, { recursive: true, force: true })),
      );
      if (cleanup.some(({ status }) => status === 'rejected')) {
        console.error(
          'Cannot remove browser download staging folder. Check temporary folder permissions.',
        );
      }
      downloads.delete(download);
    }
  }

  function cancelPendingForContents(contents) {
    for (const download of downloads) {
      if (download.contents === contents && !download.accepted) cancel(download);
    }
  }

  function shutdown() {
    shuttingDown = true;
    for (const download of downloads) cancel(download);
    return Promise.all([...downloads].map((download) => download.task));
  }

  return {
    handleWillDownload,
    cancelPendingForContents,
    shutdown,
    hasPending: () => downloads.size > 0,
  };
}

function downloadOrigin(value) {
  if (!URL.canParse(value)) return 'Unknown origin';
  const { origin } = new URL(value);
  return origin === 'null' ? 'Unknown origin' : origin;
}

function isExecutableDownload(item, filename) {
  const mimeType = item.getMimeType().split(';', 1)[0].trim().toLowerCase();
  if (EXECUTABLE_MIME_TYPES.has(mimeType)) return true;
  const names = [filename];
  for (const value of item.getURLChain()) {
    if (!URL.canParse(value)) continue;
    const url = new URL(value);
    try {
      names.push(sanitizeDownloadFilename(decodeURIComponent(url.pathname)));
    } catch {
      names.push(sanitizeDownloadFilename(url.pathname));
    }
  }
  return names.some((name) => EXECUTABLE_EXTENSIONS.has(path.extname(name).toLowerCase()));
}

module.exports = { createBrowserDownloads };
