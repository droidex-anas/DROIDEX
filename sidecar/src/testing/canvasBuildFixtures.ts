import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { CanvasFiles } from '../canvas/canvasFiles.js';
import type { CanvasManifest } from '../canvas/canvasManifest.js';
import type { CanvasBuildState, CanvasDiagnostic } from '../canvas/protocol.js';
import { instrumentSource } from '../canvas/sourceElements.js';
import { board, type Board, type BoardOptions } from './canvasBuildSupport.js';

/** A yield to the event loop, so a premature resolution becomes visible. */
export function drained(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/** The manifest as it is saved, which is what a restart would read. */
export async function savedManifest(canvas: Board): Promise<CanvasManifest> {
  const load = await new CanvasFiles(canvas.store.root).loadManifest(canvas.canvasId);
  if (load.state !== 'loaded') throw new Error(`the manifest is ${load.state}`);
  return load.manifest;
}

export function diagnosticCodes(canvas: Board, designId: string): string[] {
  const build = canvas.frame(designId).build;
  return build.status === 'failed' ? build.diagnostics.map((entry) => entry.code) : [];
}

export function diagnosticMessages(canvas: Board, designId: string): string[] {
  const build = canvas.frame(designId).build;
  return build.status === 'failed' ? build.diagnostics.map((entry) => entry.message) : [];
}

/** Every build state a published change reported for one frame, in order. */
export function reportedStates(canvas: Board, designId: string): CanvasBuildState[] {
  return canvas.changes.flatMap((change) =>
    change.frames.filter((frame) => frame.designId === designId).map((frame) => frame.build),
  );
}

export async function readyElementMap(
  t: TestContext,
  source = 'export default function App(){ return <h1>v1</h1> }',
) {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, source);
  const elements = instrumentSource({ 'main.tsx': source }, receipt.revisionId).elements;
  (await canvas.fleet.compile(1)).ready('artifact-one', elements);
  await canvas.reported(designId, 'ready');
  return { canvas, designId, source, receipt, elements };
}

/** A canonical first revision whose compiler remains under the caller's control. */
export async function buildingDesign(t: TestContext, options: BoardOptions = {}) {
  const canvas = await board(t, options);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const receipt = await canvas.write(designId, null, 'v1');
  return { canvas, designId, receipt };
}

export function readyState(
  revisionId: string,
  artifactId: string,
  generation: number,
): CanvasBuildState {
  return { status: 'ready', revisionId, artifactId, elements: [], diagnostics: [], generation };
}

/** The fixture owns recovery of its accepted revision independently of renderer watches. */
export function recoverArtifact(canvas: Board, designId: string, revisionId: string) {
  return canvas.builds.readArtifact(canvas.canvasId, designId, revisionId, () => true);
}

/** Two distinct designs share one workspace and its two physical build slots. */
export async function twoDesigns(t: TestContext) {
  const canvas = await board(t);
  const [one, two] = await canvas.create('One', 'Two');
  assert.ok(one && two);
  return { canvas, one, two };
}

/** A missing saved outcome restores pending and admits only its exact revision on demand. */
export async function rebuildAfterCacheMiss(
  t: TestContext,
  canvas: Board,
  designId: string,
  revisionId: string,
  options: BoardOptions = {},
) {
  const reopened = await board(t, { store: canvas.store, ...options });
  assert.deepEqual(reopened.frame(designId).build, { status: 'pending', generation: 0 });
  reopened.builds.requestRebuilds(reopened.workspace.snapshot(reopened.canvasId));
  assert.equal((await reopened.fleet.compile(1)).input.revisionId, revisionId);
}

export async function diagnosticFailure(t: TestContext, details: Omit<CanvasDiagnostic, 'code'>) {
  const canvas = await board(t);
  const [designId] = await canvas.create('Broken');
  assert.ok(designId);
  await canvas.write(designId, null, 'export default () => null');
  (await canvas.fleet.compile(1)).failed('missing_module', details);
  await canvas.reported(designId, 'failed');
  return { canvas, designId };
}
