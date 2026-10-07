import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { CanvasFiles } from '../canvas/canvasFiles.js';
import type { CanvasManifest } from '../canvas/canvasManifest.js';
import type { CanvasBuildState } from '../canvas/protocol.js';
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

export async function readyElementMap(t: TestContext) {
  const canvas = await board(t);
  const [designId] = await canvas.create('Hey');
  assert.ok(designId);
  const source = 'export default function App(){ return <h1>v1</h1> }';
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
