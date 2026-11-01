import assert from 'node:assert/strict';
import test from 'node:test';
import { pinScratchProfile } from '../testing/canvasStorageSupport.js';
import {
  CompileFailedError,
  CompilerUnavailableError,
  type CompileInput,
  type CompiledDesign,
} from './compiler.js';
import { discardProposal, proposeDesignSystem, readProposal } from './designSystemProposals.js';
import { readDesignSystem, saveDesignSystem } from './designSystems.js';
import { KitPreviews } from './kitPreviews.js';
import { CLAUDE_INSPIRED_DESIGN_SYSTEM } from './presets/claude-inspired.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';
import { OPENAI_INSPIRED_DESIGN_SYSTEM } from './presets/openai-inspired.js';
import type { DesignSystemProposalRef, DesignSystemRef } from './protocol.js';

pinScratchProfile();

const LIGHT: DesignSystemRef = { id: 'droidex', version: 1, mode: 'light' };
const DARK: DesignSystemRef = { ...LIGHT, mode: 'dark' };

/** A compiler that answers each compile with what `answer` returns, counting them. */
function countingPreviews(
  answer: (input: CompileInput) => CompiledDesign | Promise<CompiledDesign>,
) {
  const compiled: CompileInput[] = [];
  const previews = new KitPreviews({
    compiler: () => ({
      compile: async (input) => {
        compiled.push(input);
        return answer(input);
      },
      terminate: () => Promise.resolve(),
    }),
  });
  return { previews, compiled };
}

/** Every preview the shipped kits have, in both modes. */
function presetPreviews(): { ref: DesignSystemRef; item: string }[] {
  const systems = [
    DROIDEX_DESIGN_SYSTEM,
    OPENAI_INSPIRED_DESIGN_SYSTEM,
    CLAUDE_INSPIRED_DESIGN_SYSTEM,
  ];
  return systems.flatMap(({ id, version, sections }) =>
    (['light', 'dark'] as const).flatMap((mode) =>
      sections.flatMap((section) =>
        section.items.flatMap((entry) =>
          entry.kind === 'preview' ? [{ ref: { id, version, mode }, item: entry.id }] : [],
        ),
      ),
    ),
  );
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

test('a preview compiles once per version, mode and item while it is pending or kept', async () => {
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

  // More compiles in flight than the cache keeps: a reread still joins its own.
  const held: (() => void)[] = [];
  const slow = countingPreviews(
    () => new Promise((resolve) => held.push(() => resolve(design('<html></html>')))),
  );
  const targets = presetPreviews();
  assert.ok(targets.length > 32);
  const reads = targets.map(({ ref, item }) => slow.previews.read(ref, item));
  reads.push(slow.previews.read(targets[0].ref, targets[0].item));
  for (let turn = 0; held.length < targets.length && turn < 1000; turn++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(slow.compiled.length, targets.length);

  // A compile that settles after close answers no one.
  await slow.previews.close();
  for (const release of held) release();
  for (const read of reads) await assert.rejects(read, { code: 'scope_expired' });
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
  await assert.rejects(previews.read(LIGHT, 'typography'), { code: 'scope_expired' });
});

test("a waiting proposal's previews build from its own examples, and a settled one's no longer do", async () => {
  const { previews } = countingPreviews((input) =>
    design(input.kind === 'kitPreview' ? input.example : ''),
  );
  await saveDesignSystem(
    { ...DROIDEX_DESIGN_SYSTEM, id: 'proposed' },
    { mutationId: 'proposed-v1', baseVersion: null, savedBy: { actor: 'user' } },
  );
  const saved = await readDesignSystem({ id: 'proposed', version: 1 });
  const cover =
    saved.cover?.kind === 'preview' ? saved.cover.example : assert.fail('a preview cover');
  const proposed = structuredClone(saved);
  proposed.examples[cover] = 'export default () => "Proposed cover";';
  proposed.examples['Pricing.tsx'] = 'export default () => "Pricing";';
  const section = proposed.sections.find(({ kind }) => kind === 'components');
  assert.ok(section?.kind === 'components');
  section.items.push({
    kind: 'preview',
    id: 'pricing',
    title: 'Pricing',
    example: 'Pricing.tsx',
    width: 960,
    height: 640,
  });
  await proposeDesignSystem(proposed, {
    mutationId: 'proposal',
    baseVersion: 1,
    appSessionId: 'chat-one',
    beforePublish: () => undefined,
  });
  const proposalId = (await readProposal('proposed'))?.proposalId ?? assert.fail('a proposal');
  const ref: DesignSystemProposalRef = { id: 'proposed', proposalId, mode: 'light' };
  const source = async (target: DesignSystemRef | DesignSystemProposalRef, item: string) => {
    const preview = await previews.read(target, item);
    return preview.status === 'ready' ? preview.artifact.html : null;
  };

  assert.equal(await source(ref, 'cover'), proposed.examples[cover]);
  assert.equal(await source(ref, 'pricing'), proposed.examples['Pricing.tsx']);
  assert.equal(
    await source({ id: 'proposed', version: 1, mode: 'light' }, 'cover'),
    saved.examples[cover],
  );

  await discardProposal('proposed', proposalId);
  await assert.rejects(previews.read(ref, 'typography'), { code: 'invalid_input' });
  await previews.close();
});
