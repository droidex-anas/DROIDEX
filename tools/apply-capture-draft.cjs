const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
if (process.env.GITHUB_REF !== 'refs/heads/feat/capture-studio-draft') throw new Error('This integration applies only to the capture draft branch');
const touched = new Set();
function replace(file, before, after) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) throw new Error(`Expected one integration anchor in ${file}: ${before.slice(0, 100)}`);
  fs.writeFileSync(file, source.replace(before, after)); touched.add(file);
}
function write(file, contents) { fs.writeFileSync(file, contents); touched.add(file); }

replace('electron/main.cjs', "const { installApplicationMenu } = require('./applicationMenu.cjs');", "const { installApplicationMenu } = require('./applicationMenu.cjs');\nconst { installCaptureService } = require('./capture/service.cjs');");
replace('electron/main.cjs', 'let mainWindow = null;', 'let mainWindow = null;\nlet captureService = null;');
replace('electron/main.cjs', "  const attachmentsDir = path.join(os.tmpdir(), 'droidex-attachments');", "  const attachmentsDir = path.join(os.tmpdir(), 'droidex-attachments');\n  captureService = installCaptureService({\n    electron: require('electron'), app, getMainWindow: () => mainWindow,\n    saveImage: (dataUrl) => attachments.save(attachmentsDir, dataUrl),\n  });");
replace('electron/main.cjs', "app.on('before-quit', () => {", "app.on('before-quit', () => {\n  captureService?.dispose();");
replace('electron/main.cjs', "  mainWindow.on('closed', () => {", "  mainWindow.on('closed', () => {\n    captureService?.cancel();");
replace('electron/capture/preload.cjs', "const { contextBridge, ipcRenderer } = require('electron');\n\n", 'function installCapturePreload({ contextBridge, ipcRenderer }) {\n');
fs.appendFileSync('electron/capture/preload.cjs', '\n}\nmodule.exports = { installCapturePreload };\n');
fs.appendFileSync('electron/preload.cjs', "\nrequire('./capture/preload.cjs').installCapturePreload({ contextBridge, ipcRenderer });\n"); touched.add('electron/preload.cjs');
replace('electron/preload.test.cjs', '  let api;', '  let api;\n  let captureApi;');
replace('electron/preload.test.cjs', "      if (name !== 'electron') throw new Error(`Unexpected preload dependency: ${name}`);", "      if (name === './capture/preload.cjs') return require('./capture/preload.cjs');\n      if (name !== 'electron') throw new Error(`Unexpected preload dependency: ${name}`);");
replace('electron/preload.test.cjs', '          exposeInMainWorld(_name, exposed) {\n            api = exposed;\n          },', "          exposeInMainWorld(name, exposed) {\n            if (name === 'droidControl') api = exposed;\n            if (name === 'droidCapture') captureApi = exposed;\n          },");
replace('electron/preload.test.cjs', '  return { api, calls, listeners, removedListeners, posts, channels };', '  return { api, captureApi, calls, listeners, removedListeners, posts, channels };');
fs.appendFileSync('electron/preload.test.cjs', String.raw`

test('capture preload restricts operations and releases its shortcut listener', async () => {
  const { captureApi, calls, listeners, removedListeners } = loadApi();
  await captureApi.take({ requestId: 'capture-1', mode: 'area', operation: 'delete' });
  assert.equal(calls[0].channel, 'capture:request');
  assert.equal(calls[0].payload.operation, 'take');
  assert.equal(calls[0].payload.mode, 'area');
  let fired = 0;
  const release = captureApi.onShortcut(() => { fired += 1; });
  listeners[0].listener({ privateElectronEvent: true });
  assert.equal(fired, 1);
  release();
  assert.equal(removedListeners.length, 1);
  assert.equal(removedListeners[0].listener, listeners[0].listener);
});
`);
replace('electron/capture/native.cjs', '  const image = await contents.capturePage(box);', '  const zoom = contents.getZoomFactor();\n  const dipBox = { x: Math.floor(box.x * zoom), y: Math.floor(box.y * zoom), width: Math.ceil(box.width * zoom), height: Math.ceil(box.height * zoom) };\n  const image = await contents.capturePage(dipBox);');
replace('electron/capture/native.cjs', '  const buffer = image.toPNG(); png(buffer); return buffer;', '  const buffer = image.toPNG({ scaleFactor: Math.max(1, ...image.getScaleFactors()) }); png(buffer); return buffer;');

replace('src/main.tsx', "import App from './App';", "import App from './App';\nimport { CaptureShortcutHost } from './features/capture/CaptureShortcutHost';");
replace('src/main.tsx', '      <App />', '      <App />\n      <CaptureShortcutHost />');
replace('src/components/SettingsPanel.tsx', "import { ToolActivitySettings } from './ToolActivitySettings';", "import { ToolActivitySettings } from './ToolActivitySettings';\nimport { CaptureSettings } from '../features/capture/CaptureSettings';");
replace('src/components/SettingsPanel.tsx', "      { label: 'Appearance' },", "      { label: 'Appearance' },\n      { label: 'Screenshots' },");
replace('src/components/SettingsPanel.tsx', "    case 'General':", "    case 'Screenshots':\n      content = <CaptureSettings onClose={close} />;\n      break;\n    case 'General':");
replace('src/lib/settingsSearch.ts', 'export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [', "export const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [\n  e('Screenshots', 'Capture backgrounds', ['screenshot', 'snip', 'gradient', 'padding', 'corners', 'shadow', 'texture']),\n  e('Screenshots', 'Recent captures', ['history', 'image', 'edit', 'copy', 'export', 'attach']),\n  e('Screenshots', 'Capture sound and shortcut', ['shutter', 'sound', 'hotkey', 'screen capture']),");

replace('src/hooks/useImageAttachments.ts', "import { useCallback, useRef, useState } from 'react';", "import { useCallback, useEffect, useRef, useState } from 'react';\nimport type { CaptureAttachment, CaptureMetadata } from '../features/capture/types';");
replace('src/hooks/useImageAttachments.ts', '  /** Data URL of the saved (fidelity-processed) image, used for chips/viewer. */', '  /** Display preview. Capture previews are thumbnails, never export or crop sources. */');
replace('src/hooks/useImageAttachments.ts', '  sequence: number;\n}', '  sequence: number;\n  capture?: CaptureMetadata;\n}');
replace('src/hooks/useImageAttachments.ts', '  const remove = (id: string) => {', String.raw`  const addCapture = (pending: Promise<CaptureAttachment>, sequence: number, replaceImageId?: string): Promise<boolean> => {
    const previous = replaceImageId ? imagesRef.current.find(image => image.id === replaceImageId) : undefined;
    const seq = previous?.sequence ?? sequence;
    nextSeqRef.current = Math.max(nextSeqRef.current, seq + 1);
    const stamp = additions.stamp();
    const task = (async () => {
      try {
        const attachment = await pending;
        const existing = replaceImageId ? imagesRef.current.find(image => image.id === replaceImageId) : undefined;
        if (additions.isStale(stamp) || (replaceImageId && !existing)) {
          await discardImage(attachment.path);
          return false;
        }
        const image: AttachedImage = { id: replaceImageId ?? crypto.randomUUID(), ...attachment, sequence: seq };
        sequencesRef.current.set(image.id, seq);
        if (existing) {
          commit(imagesRef.current.map(item => item.id === existing.id ? image : item));
          void discardImage(existing.path);
        } else commit(insertBySequence(imagesRef.current, image, sequencesRef.current));
        return true;
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) toast.error(error instanceof Error ? error.message : 'Could not attach this capture');
        return false;
      }
    })();
    additions.track(task);
    if (previous) crops.track(previous.sequence, task);
    return task;
  };

  const remove = (id: string) => {`);
replace('src/hooks/useImageAttachments.ts', '    if (!target) return;\n    // Tracked', "    if (!target) return;\n    if (target.capture) throw new Error('Open Capture to edit this screenshot from its original pixels');\n    // Tracked");
replace('src/hooks/useImageAttachments.ts', '  return { images, addBlob, remove, applyCrop, clear, clearAndDiscard, whenReady, clearReady };', String.raw`  useEffect(() => () => {
    additions.invalidate();
    for (const image of imagesRef.current) void discardImage(image.path);
  }, [additions]);

  return { images, addBlob, addCapture, remove, applyCrop, clear, clearAndDiscard, whenReady, clearReady };`);
replace('src/components/PromptInput.tsx', "import ImageChip from './composer/ImageChip';", "import ImageChip from './composer/ImageChip';\nimport { CaptureAttachmentCard } from '../features/capture/CaptureAttachmentCard';\nimport { useCaptureComposer } from '../features/capture/useCaptureComposer';");
replace('src/components/PromptInput.tsx', '  const stopTurnStarting = useCallback(() => {', "  const capture = useCaptureComposer(visibleTargetKey + ':' + (state.draftChat?.cwd ?? ''), imageAttachments, takeIntakeSeq);\n  const stopTurnStarting = useCallback(() => {");
replace('src/components/PromptInput.tsx', '    const clearAfterSubmit = () => {', '    const clearAfterSubmit = () => {\n      capture.invalidate();');
replace('src/components/PromptInput.tsx', '              {imageAttachments.images.map((img) => (\n                <ImageChip', String.raw`              {imageAttachments.images.map((img) => img.capture ? (
                <CaptureAttachmentCard key={img.id} preview={img.preview} capture={img.capture}
                  onOpen={() => { if (img.capture) capture.edit(img.capture.id, img.id); }}
                  onRemove={() => imageAttachments.remove(img.id)} />
              ) : (
                <ImageChip`);
replace('src/components/PromptInput.tsx', '              <AddMenu\n', '              <AddMenu\n                onCapture={capture.open}\n');
replace('src/components/PromptInput.tsx', '      {viewerImage && (', '      {capture.surface}\n      {viewerImage && (');
replace('src/components/composer/AddMenu.tsx', "import { FolderOpen, Plus } from 'lucide-react';", "import { FolderOpen, Plus, Scan } from 'lucide-react';");
replace('src/components/composer/AddMenu.tsx', '  onAttachFiles,\n', '  onAttachFiles,\n  onCapture,\n');
replace('src/components/composer/AddMenu.tsx', '  onAttachFiles: () => void;', '  onAttachFiles: () => void;\n  onCapture?: () => void;');
replace('src/components/composer/AddMenu.tsx', '            <SectionTitle>Plugins</SectionTitle>', String.raw`            {onCapture && <MenuRow icon={Scan} label="Screenshot" hint="Capture a screen, window, or component" onRun={() => { close(); onCapture(); }} />}
            <SectionTitle>Plugins</SectionTitle>`);
replace('src/components/composer/AddMenu.tsx', 'title="Add files or a plugin"', 'title="Add files, a screenshot, or a plugin"');

// Optional custom colors are bounded values, never CSS supplied to the host.
replace('src/features/capture/types.ts', 'export interface CaptureStyle { preset:', 'export interface CaptureStyle { colors?: [string, string, string]; preset:');
replace('electron/capture/validation.cjs', "  if (!PRESETS.includes(v.preset)) throw new Error('Unknown capture background');", "  if (!PRESETS.includes(v.preset)) throw new Error('Unknown capture background');\n  if (v.colors !== undefined && (!Array.isArray(v.colors) || v.colors.length !== 3 || !v.colors.every(color => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)))) throw new Error('Invalid gradient colors');");
replace('electron/capture/validation.cjs', '    preset: v.preset,', '    preset: v.preset,\n    ...(v.colors ? { colors: [...v.colors] } : {}),');
replace('src/features/capture/StyleControls.tsx', "import { BACKGROUNDS } from './presets';", "import { BACKGROUNDS, backgroundFor } from './presets';");
replace('src/features/capture/StyleControls.tsx', '  return <fieldset', '  const colors = value.colors ?? backgroundFor(value.preset).colors;\n  return <fieldset');
replace('src/features/capture/StyleControls.tsx', 'onChange({ ...value, preset: preset.id })', 'onChange({ ...value, preset: preset.id, colors: undefined })');
replace('src/features/capture/StyleControls.tsx', '    {([\n', String.raw`    <div className="capture-colors">{colors.map((color, index) => <label key={index}>Color {index + 1}<input type="color" aria-label={'Gradient color ' + (index + 1)} value={color} disabled={value.preset === 'transparent'} onChange={event => { const next: [string, string, string] = [...colors]; next[index] = event.target.value; onChange({ ...value, colors: next }); }} /></label>)}</div>
    {([
`);
replace('src/features/capture/render.ts', '  const preset = backgroundFor(style.preset);', '  const preset = backgroundFor(style.preset);\n  const colors = style.colors ?? preset.colors;');
let render = fs.readFileSync('src/features/capture/render.ts', 'utf8').replaceAll('preset.colors[', 'colors[');
render = render.replace('    ctx.save(); ctx.shadowColor', "    ctx.save();\n    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.roundRect(padding, padding, crop.width, crop.height, radius); ctx.clip('evenodd');\n    ctx.shadowColor");
write('src/features/capture/render.ts', render);
replace('src/features/capture/CaptureSettings.tsx', '    void Promise.all([captureApi().preferences(), captureApi().list()])', "    if (!window.droidCapture) { setError('Screenshot settings need the DROIDEX desktop app'); return () => { alive.current = false; }; }\n    void Promise.all([captureApi().preferences(), captureApi().list()])");
replace('src/features/capture/CaptureFrame.tsx', 'nodes[(index + (event.shiftKey ? nodes.length - 1 : 1)) % nodes.length].focus();', 'nodes[index < 0 ? (event.shiftKey ? nodes.length - 1 : 0) : (index + (event.shiftKey ? nodes.length - 1 : 1)) % nodes.length].focus();');
replace('src/features/capture/CaptureDialog.tsx', '  const audio = new AudioContext();', "  const audio = new AudioContext();\n  const timeout = setTimeout(() => { if (audio.state !== 'closed') void audio.close(); }, 1000);");
replace('src/features/capture/CaptureDialog.tsx', '  } finally { await audio.close(); }', "  } finally { clearTimeout(timeout); if (audio.state !== 'closed') await audio.close(); }");

let css = fs.readFileSync('src/features/capture/capture.css', 'utf8');
const selectionStart = css.indexOf('.capture-crop-help');
const selectionEnd = css.indexOf('.capture-attachment{');
write('src/features/capture/captureSelection.css', css.slice(selectionStart, selectionEnd));
css = css.slice(0, selectionStart) + css.slice(selectionEnd);
const settingsStart = css.indexOf('.capture-settings .capture-swatches');
const settingsEnd = css.indexOf('@keyframes');
write('src/features/capture/captureSettings.css', css.slice(settingsStart, settingsEnd));
css = css.slice(0, settingsStart) + css.slice(settingsEnd);
write('src/features/capture/capture.css', "@import './captureSelection.css';\n@import './captureSettings.css';\n" + css + '\n.capture-colors{display:flex;gap:10px;margin-bottom:20px}.capture-colors label{display:flex;flex:1;flex-direction:column;gap:6px;font-size:10px;color:var(--droid-text-muted)}.capture-colors input{width:100%;height:26px;border:1px solid var(--droid-border);border-radius:6px;background:transparent;padding:2px}\n');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.scripts.test += ' && node --test electron/capture/*.test.cjs';
pkg.scripts['electron:check'] += ' && node --check electron/capture/service.cjs && node --check electron/capture/store.cjs && node --check electron/capture/native.cjs && node --check electron/capture/preload.cjs && node --check electron/capture/validation.cjs';
pkg.scripts['test:capture'] = 'node --import tsx --test "src/features/capture/*.test.ts" && node --test electron/capture/*.test.cjs';
write('package.json', JSON.stringify(pkg, null, 2) + '\n');
write('.github/workflows/capture-draft-check.yml', String.raw`name: Capture draft checks
on:
  push:
    branches: [feat/capture-studio-draft]
  pull_request:
    paths:
      - 'src/features/capture/**'
      - 'electron/capture/**'
      - 'src/components/PromptInput.tsx'
      - 'src/components/SettingsPanel.tsx'
      - 'src/hooks/useImageAttachments.ts'
      - '.github/workflows/capture-draft-check.yml'
permissions:
  contents: read
jobs:
  capture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm ci --ignore-scripts
        env:
          HUSKY: '0'
      - run: npm ci --prefix sidecar --ignore-scripts
      - run: npm run typecheck
      - run: npm run sidecar:typecheck
      - run: npm run electron:check
      - run: npm run test:capture
      - run: npx eslint src/features/capture electron/capture src/hooks/useImageAttachments.ts src/components/composer/AddMenu.tsx
      - run: npm run build
      - run: npm run test
  mac-unit:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: test -x /usr/sbin/screencapture && node --test electron/capture/*.test.cjs
`);
fs.unlinkSync(__filename);
execFileSync(process.execPath, ['node_modules/prettier/bin/prettier.cjs', '--write', 'src/features/capture', 'electron/capture', 'docs/capture.md', ...touched], { stdio: 'inherit' });
console.log('Capture integration applied. Native desktop permission and visual acceptance still require a real Mac.');
