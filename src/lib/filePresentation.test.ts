import assert from 'node:assert';
import test from 'node:test';
import { resolveFilePresentation } from './filePresentation';

test('resolveFilePresentation maps extensions, special names, and paths to a kind and language', () => {
  const cases: Array<[string, ReturnType<typeof resolveFilePresentation>]> = [
    // Stack extensions, case-insensitively.
    ['src/App.TSX', { kind: 'react', language: 'tsx' }],
    ['component.jsx', { kind: 'react', language: 'jsx' }],
    ['index.ts', { kind: 'typescript', language: 'typescript' }],
    ['server.MJS', { kind: 'javascript', language: 'javascript' }],
    ['theme.css', { kind: 'css', language: 'css' }],
    ['page.html', { kind: 'html', language: 'markup' }],
    ['README.md', { kind: 'markdown', language: 'markdown' }],
    ['worker.py', { kind: 'python', language: 'python' }],
    ['main.rs', { kind: 'rust', language: 'rust' }],
    ['scripts/release.sh', { kind: 'shell', language: 'bash' }],
    // Compound filenames use the final extension.
    ['archive.spec.ts', { kind: 'typescript', language: 'typescript' }],
    ['photo.backup.PNG', { kind: 'image' }],
    ['release.tar.gz', { kind: 'archive' }],
    // Special filenames take precedence over their extensions.
    ['package.json', { kind: 'package', language: 'json' }],
    ['config/tsconfig.build.json', { kind: 'config', language: 'json' }],
    ['vite.config.ts', { kind: 'config', language: 'typescript' }],
    ['docker-compose.dev.yml', { kind: 'docker', language: 'docker' }],
    // Extensionless names and dotfiles.
    ['Dockerfile', { kind: 'docker', language: 'docker' }],
    ['README', { kind: 'markdown', language: 'markdown' }],
    ['LICENSE', { kind: 'document' }],
    ['.env.local', { kind: 'env', language: 'bash' }],
    ['.gitignore', { kind: 'config' }],
    ['Makefile', { kind: 'config' }],
    // Binary and office formats, then the unknown fallback.
    ['design.svg', { kind: 'image', language: 'markup' }],
    ['report.PDF', { kind: 'pdf' }],
    ['brief.docx', { kind: 'document' }],
    ['budget.xlsx', { kind: 'spreadsheet' }],
    ['source.7z', { kind: 'archive' }],
    ['binary.wasm', { kind: 'unknown' }],
    ['no-extension', { kind: 'unknown' }],
    // Windows separators.
    [String.raw`C:\workspace\src\App.tsx`, { kind: 'react', language: 'tsx' }],
  ];

  for (const [filename, expected] of cases) {
    assert.deepEqual(resolveFilePresentation(filename), expected, filename);
  }
});
