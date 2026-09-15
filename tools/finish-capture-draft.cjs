const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
if (process.env.GITHUB_REF !== 'refs/heads/feat/capture-studio-draft') throw new Error('Capture refinements are restricted to the feature branch');
function edit(file, operation) {
  const before = fs.readFileSync(file, 'utf8');
  const after = operation(before);
  if (before === after) throw new Error(`No matching refinement in ${file}`);
  fs.writeFileSync(file, after);
}
function replace(file, before, after) {
  edit(file, source => {
    if (!source.includes(before)) throw new Error(`Missing anchor in ${file}: ${before}`);
    return source.replace(before, after);
  });
}
const folder = 'src/features/capture';
for (const name of fs.readdirSync(folder).filter(name => /\.tsx?$/.test(name))) {
  const file = path.join(folder, name);
  const source = fs.readFileSync(file, 'utf8');
  const updated = source
    .replace(/^import '\.\/capture\.css';\r?\n/gm, '')
    .replace(/\b(on[A-Z]\w*)(\?)?\(([^()]*)\): (void|Promise<void>);/g, (_match, name, optional, params, result) => `${name}${optional || ''}: (${params}) => ${result};`)
    .replace(/\.catch\(\(reason\) =>/g, '.catch((reason: unknown) =>')
    .replace(/String\(reason\.message \|\| reason\)/g, '(reason instanceof Error ? reason.message : String(reason))');
  if (updated !== source) fs.writeFileSync(file, updated);
}
edit('src/index.css', source => "@import './features/capture/capture.css';\n" + source);
edit('electron/capture/validation.cjs', source => {
  const start = source.indexOf('function title(value) {');
  const end = source.indexOf('\nmodule.exports', start);
  if (start < 0 || end < 0) throw new Error('Missing title validator');
  return source.slice(0, start) + `function title(value) {
  if (typeof value !== 'string') return 'Screenshot';
  return Array.from(value.slice(0, 240))
    .filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('').slice(0, 120).trim() || 'Screenshot';
}
` + source.slice(end);
});

for (const file of ['CaptureDialog.tsx', 'CaptureEditor.tsx']) {
  edit(path.join(folder, file), source => source
    .replace("import { useEffect, useRef, useState } from 'react';", "import { useEffect, useRef, useState } from 'react';\nimport { createCaptureGeneration } from './composerDestination';")
    .replace('  const alive = useRef(true);', '  const [lifetime] = useState(createCaptureGeneration);')
    .replace('    alive.current = true;', '    lifetime.invalidate();')
    .replace('      alive.current = false;', '      lifetime.invalidate();')
    .replaceAll('alive.current', 'lifetime.isCurrent(stamp)')
    .replace('  }, [captureId]);', '  }, [captureId, lifetime]);')
    .replace('  }, [original.source]);', '  }, [original.source, lifetime]);'));
}
edit(path.join(folder, 'CaptureDialog.tsx'), source => source
  .replace('async function accept(original: CaptureDocument, openEditor: boolean)', 'async function accept(original: CaptureDocument, openEditor: boolean, stamp: number)')
  .replace('    if (busy.current || !status) return;', '    if (busy.current || !status) return;\n    const stamp = lifetime.stamp();')
  .replace('    if (busy.current) return;', '    if (busy.current) return;\n    const stamp = lifetime.stamp();')
  .replace('await accept(original, editFirst);', 'await accept(original, editFirst, stamp);')
  .replace('await accept(original, true);', 'await accept(original, true, stamp);')
  .replace("document?.title || 'Edit capture'", "document?.title ?? 'Edit capture'"));
edit(path.join(folder, 'CaptureEditor.tsx'), source => source
  .replace('    if (!image || busyRef.current) return;', '    if (!image || busyRef.current) return;\n    const stamp = lifetime.stamp();')
  .replace('    if (busyRef.current) return;', '    if (busyRef.current) return;\n    const stamp = lifetime.stamp();'));
edit(path.join(folder, 'useCaptureComposer.tsx'), source => source.replace(/<CaptureDialog\s+captureId=/, '<CaptureDialog key={selection.generation} captureId='));
edit(path.join(folder, 'ComponentPicker.tsx'), source => source
  .replace('export function regionsAtPoint', 'function regionsAtPoint')
  .replace('latest.current.regions[latest.current.index]', 'latest.current.regions.at(latest.current.index)')
  .replace('const active = regions[index];', 'const active = regions.at(index);')
  .replace('next[0]?.element', 'next.at(0)?.element')
  .replace('latest.current.regions[0]?.element', 'latest.current.regions.at(0)?.element')
  .replace('!previous || previous.rect.width !== rect.width || previous.rect.height !== rect.height', 'previous?.rect.width !== rect.width || previous.rect.height !== rect.height')
  .replace('element.dataset.captureLabel ||', 'element.dataset.captureLabel ??')
  .replace("element.getAttribute('aria-label')?.slice(0, 60) ||", "element.getAttribute('aria-label')?.slice(0, 60) ??")
  .replace("element.getAttribute('role') ||", "element.getAttribute('role') ??"));
edit(path.join(folder, 'detection.ts'), source => source
  .replace('seams(raster, box, true)[0]', 'seams(raster, box, true).at(0)')
  .replace('seams(raster, box, false)[0]', 'seams(raster, box, false).at(0)'));
replace(path.join(folder, 'StyleControls.tsx'), "'Gradient color ' + (index + 1)", "'Gradient color ' + String(index + 1)");

// Convert numeric interpolation deliberately, using the repository's actual
// type checker rather than replacing arbitrary template-literal text.
const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
for (const source of program.getSourceFiles()) {
  if (!source.fileName.includes('/src/features/capture/')) continue;
  const edits = [];
  function visit(node) {
    if (ts.isTemplateSpan(node)) {
      const type = checker.getTypeAtLocation(node.expression);
      if ((type.flags & ts.TypeFlags.NumberLike) || (type.isUnion() && type.types.some(member => member.flags & ts.TypeFlags.NumberLike))) {
        edits.push({ start: node.expression.getStart(source), end: node.expression.end, text: `String(${node.expression.getText(source)})` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (edits.length) {
    let text = source.text;
    for (const change of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, change.start) + change.text + text.slice(change.end);
    fs.writeFileSync(source.fileName, text);
  }
}
fs.unlinkSync(__filename);
try { execFileSync(process.execPath, ['node_modules/eslint/bin/eslint.js', '--fix', 'src/features/capture', 'electron/capture'], { stdio: 'inherit' }); }
catch (error) { if (error.status !== 1) throw error; }
execFileSync(process.execPath, ['node_modules/prettier/bin/prettier.cjs', '--write', 'src/features/capture', 'electron/capture', 'src/index.css', 'tools/capture-ui-smoke.mjs'], { stdio: 'inherit' });
