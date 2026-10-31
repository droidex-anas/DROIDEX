import assert from 'node:assert/strict';
import test from 'node:test';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import {
  CompileFailedError,
  CompilerUnavailableError,
  type CompileInput,
  type CompiledDesign,
} from './compiler.js';
import { KitPreviews } from './kitPreviews.js';
import type { DesignSystemRef } from './protocol.js';

pinScratchProfile();

const LIGHT: DesignSystemRef = { id: 'droidex', version: 1, mode: 'light' };
const DARK: DesignSystemRef = { ...LIGHT, mode: 'dark' };

/** A compiler that answers each compile with what `answer` returns, counting them. */
function countingPreviews(answer: (input: CompileInput) => CompiledDesign) {
  const compiled: CompileInput[] = [];
  const previews = new KitPreviews({
    compiler: () => ({
      compile: (input) => {
        compiled.push(input);
        return Promise.resolve(answer(input));
      },
      terminate: () => Promise.resolve(),
    }),
  });
  return { previews, compiled };
}

const design = (html: string): CompiledDesign => ({
  artifactId: html,
  html,
  diagnostics: [],
  elements: [],
});

test("a kit's cover and typography specimen compile into preview documents", async (t) => {
  const previews = new KitPreviews();
  t.after(() => previews.close());

  for (const item of ['cover', 'typography']) {
    const preview = await previews.read(DARK, item);
    assert.equal(preview.status, 'ready', item);
    assert.ok(preview.status === 'ready' && preview.artifact.html.includes('<html'), item);
  }
});

test('a preview compiles once per version, mode and item while it is kept', async () => {
  const { previews, compiled } = countingPreviews(() => design('<html></html>'));

  const [first, second] = await Promise.all([
    previews.read(LIGHT, 'cover'),
    previews.read(LIGHT, 'cover'),
  ]);
  assert.deepEqual(first, second);
  await previews.read(DARK, 'cover');
  await previews.read(LIGHT, 'typography');
  await previews.read(LIGHT, 'cover');

  assert.equal(compiled.length, 3);
  await previews.close();
});

test("a source's diagnostics are kept, a lost compiler is tried again", async () => {
  let lost = true;
  const { previews, compiled } = countingPreviews((input) => {
    const example = input.kind === 'kitPreview' ? input.example : '';
    if (example.includes('Typography'))
      throw new CompileFailedError([{ code: 'compile_error', message: 'Broken.' }]);
    if (lost) {
      lost = false;
      throw new CompilerUnavailableError('lost-compiler', 'gone');
    }
    return design('<html></html>');
  });

  const broken = await previews.read(LIGHT, 'typography');
  assert.deepEqual(broken, {
    status: 'failed',
    diagnostics: [{ code: 'compile_error', message: 'Broken.' }],
  });
  assert.deepEqual(await previews.read(LIGHT, 'typography'), broken);

  const unavailable = await previews.read(LIGHT, 'cover');
  assert.equal(unavailable.status, 'failed');
  assert.equal((await previews.read(LIGHT, 'cover')).status, 'ready');
  assert.equal(compiled.length, 3);

  await assert.rejects(previews.read(LIGHT, 'no-such-preview'), { code: 'invalid_input' });
  await previews.close();
  await assert.rejects(previews.read(DARK, 'cover'), { code: 'scope_expired' });
});
