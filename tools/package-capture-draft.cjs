const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
if (process.env.GITHUB_REF !== 'refs/heads/feat/capture-studio-draft') throw new Error('Capture integration is restricted to the feature branch');
function edit(file, update) {
  const source = fs.readFileSync(file, 'utf8');
  const next = update(source);
  if (next === source) throw new Error(`Missing capture integration anchor: ${file}`);
  fs.writeFileSync(file, next);
}
edit('src/index.css', source => source.replace("@import './features/capture/capture.css';\n", ''));
edit('src/components/SettingsPanel.tsx', source => source
  .replace("import { useEffect, useRef, useState } from 'react';", "import { lazy, Suspense, useEffect, useRef, useState } from 'react';")
  .replace("import { CaptureSettings } from '../features/capture/CaptureSettings';", "const CaptureSettings = lazy(() => import('../features/capture/CaptureSettings').then(module => ({ default: module.CaptureSettings })));")
  .replace('content = <CaptureSettings onClose={close} />;', 'content = <Suspense fallback={<p className="text-sm text-droid-text-muted" role="status">Loading screenshot settings…</p>}><CaptureSettings onClose={close} /></Suspense>;'));
for (const file of ['CaptureDialog.tsx', 'CaptureSettings.tsx']) edit(`src/features/capture/${file}`, source => "import './capture.css';\n" + source);
edit('src/features/capture/capture.css', source => {
  const start = source.indexOf('.capture-attachment {');
  const end = source.indexOf('@keyframes capture-arrive', start);
  if (start < 0 || end < 0) throw new Error('Capture card styles could not be isolated');
  return source.slice(0, start) + source.slice(end);
});
fs.writeFileSync('src/features/capture/CaptureAttachmentCard.tsx', `import { motion, useReducedMotion } from 'framer-motion';
import { Scan, X } from 'lucide-react';
import type { CaptureMetadata } from './types';

export function CaptureAttachmentCard({ preview, capture, onOpen, onRemove }: {
  preview: string;
  capture: CaptureMetadata;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const reducedMotion = useReducedMotion();
  return <motion.div
    className="capture-attachment relative w-60 max-w-full overflow-hidden rounded-xl border border-droid-border bg-droid-surface"
    initial={reducedMotion ? false : { opacity: 0, y: 16, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
  >
    <button type="button" className="block w-full p-2 text-left" onClick={onOpen} aria-label={'Edit screenshot: ' + capture.title}>
      <img src={preview} alt={capture.title} className="h-32 w-full rounded-lg bg-droid-bg object-contain" />
      <span className="flex items-center gap-2 px-1 pb-1 pt-2 text-xs text-droid-text"><Scan size={14} className="shrink-0"/><span className="truncate">{capture.title}</span></span>
      <span className="block px-1 pb-1 text-[10px] text-droid-text-muted">{capture.width} × {capture.height} · PNG · Edit</span>
    </button>
    <button type="button" className="absolute right-3 top-3 grid place-items-center rounded-full border border-droid-border bg-droid-surface p-1 text-droid-text-secondary hover:text-droid-text" aria-label={'Remove ' + capture.title} onClick={onRemove}><X size={13}/></button>
  </motion.div>;
}
`);

const aliases = { id: 'validateId', png: 'validatePng', rect: 'validateRect', title: 'sanitizeTitle', recipe: 'validateRecipe', preferences: 'validatePreferences', style: 'validateStyle' };
function explicitValidationImports(file, namespace) {
  edit(file, source => {
    const fields = [...new Set([...source.matchAll(new RegExp(`\\b${namespace}\\.(\\w+)`, 'g'))].map(match => match[1]))].sort();
    const names = fields.map(field => aliases[field] ? `${field}: ${aliases[field]}` : field).join(', ');
    let next = source.replace(`const ${namespace} = require('./validation.cjs');`, `const { ${names} } = require('./validation.cjs');`);
    for (const field of fields) next = next.replaceAll(`${namespace}.${field}`, aliases[field] || field);
    return next;
  });
}
explicitValidationImports('electron/capture/store.cjs', 'validate');
explicitValidationImports('electron/capture/service.cjs', 'validate');
explicitValidationImports('electron/capture/capture.test.cjs', 'v');
edit('electron/capture/validation.cjs', source => source.replace('  PRESETS,\n', '').replace('  SHORTCUTS,\n', '').replace('  DEFAULT_STYLE,\n', ''));
edit('electron/capture/store.cjs', source => source.replace('module.exports = { createCaptureStore, MAX_RECORDS, MAX_STORE_BYTES };', 'module.exports = { createCaptureStore, MAX_RECORDS };'));
edit('electron/preload.cjs', source => source.replace("require('./capture/preload.cjs').installCapturePreload({ contextBridge, ipcRenderer });", "const { installCapturePreload } = require('./capture/preload.cjs');\ninstallCapturePreload({ contextBridge, ipcRenderer });"));
edit('src/features/capture/geometry.ts', source => source.replace('export function intersection(', 'function intersection('));
edit('src/features/capture/render.ts', source => source.replace('export function blobDataUrl(', 'function blobDataUrl('));
edit('src/features/capture/presets.ts', source => source
  .replace('CapturePreset, CaptureStyle', 'CapturePreset')
  .replace(/export const DEFAULT_CAPTURE_STYLE: CaptureStyle = \{[\s\S]*?\n\};\n/, ''));

fs.unlinkSync(__filename);
execFileSync(process.execPath, ['node_modules/prettier/bin/prettier.cjs', '--write', 'src/features/capture', 'electron/capture', 'src/index.css', 'src/components/SettingsPanel.tsx', 'electron/preload.cjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['tools/generate-docs.mjs'], { stdio: 'inherit' });
