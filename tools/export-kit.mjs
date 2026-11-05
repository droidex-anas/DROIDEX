// Copies a kit version saved in a DROIDEX profile into the sidecar as a
// built-in preset: the version's document and source as system.json, and the
// cover and preview captures it has, so the preset's pictures ship with it.
// The preset keeps its own id, version and name; the kit's save record,
// provenance and who saved each note stay in the profile.
//
//   npm run kits:export -- --profile <dir> --kit <id> [--version N] [--as droidex] [--name DROIDEX]

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';

const PRESETS_DIR = resolve(import.meta.dirname, '../sidecar/src/canvas/presets');
// Designs pin a preset's one version, so an export replaces its content in place.
const PRESET_VERSION = 1;
const IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const CAPTURE = /^[a-z0-9-]+-(?:light|dark)\.png$/;

function fail(message) {
  console.error(`kits:export: ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    profile: { type: 'string' },
    kit: { type: 'string' },
    version: { type: 'string' },
    as: { type: 'string', default: 'droidex' },
    name: { type: 'string' },
  },
});
if (!values.profile || !values.kit) fail('Name the profile and the kit: --profile <dir> --kit <id>.');
if (!IDENTIFIER.test(values.kit) || !IDENTIFIER.test(values.as))
  fail('A kit or preset id has only letters, digits, hyphens and underscores.');

const kitDir = join(resolve(values.profile), 'canvases', 'design-systems', values.kit);
const version = values.version === undefined ? latestVersion() : Number(values.version);
if (!Number.isSafeInteger(version) || version < 1) fail('--version is a whole number from 1.');
const system = savedSystem();
if (system.cover?.kind === 'image' || JSON.stringify(system).includes('kit-asset:'))
  fail(`${values.kit} v${version} uses kit images, which a preset cannot ship yet.`);

const presetDir = join(PRESETS_DIR, values.as);
const name = values.name ?? existingName();
if (name === undefined) fail(`No preset ${values.as} exists yet. Name it: --name <name>.`);
const previous = `${presetDir}.previous`;
if (existsSync(previous))
  fail(`${previous} is left from an export that did not finish. Move it back to ${presetDir} or delete it, then export again.`);

const staging = `${presetDir}.export`;
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, 'previews'), { recursive: true });
const preset = {
  id: values.as,
  version: PRESET_VERSION,
  name,
  cover: system.cover,
  sections: system.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => (item.kind === 'note' ? { ...item, author: 'user' } : item)),
  })),
  files: system.files,
  examples: system.examples,
};
writeFileSync(join(staging, 'system.json'), `${JSON.stringify(preset, null, 2)}\n`);
const copied = copyCaptures();
publish();

console.log(`Exported ${values.kit} v${version} as the ${values.as} preset (${name}).`);
console.log(`Cover: ${copied.cover.join(' and ') || 'none'}. Preview captures: ${copied.previews}.`);
if (copied.missing.length > 0)
  console.log(
    `Not captured yet: ${copied.missing.join(', ')}. Open the kit in both modes and export again to ship them.`,
  );

function latestVersion() {
  if (!existsSync(kitDir)) fail(`No kit ${values.kit} in ${kitDir}.`);
  const versions = readdirSync(kitDir)
    .filter((entry) => /^[1-9][0-9]*\.json$/.test(entry))
    .map((entry) => Number(entry.slice(0, -'.json'.length)));
  if (versions.length === 0) fail(`Kit ${values.kit} has no saved version in ${kitDir}.`);
  return Math.max(...versions);
}

function savedSystem() {
  const path = join(kitDir, `${version}.json`);
  if (!existsSync(path)) fail(`Kit ${values.kit} has no version ${version}: ${path} does not exist.`);
  let saved;
  try {
    saved = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${path} is damaged: ${error.message}`);
  }
  const kit = saved?.system;
  const isWhole =
    kit?.id === values.kit &&
    kit.version === version &&
    typeof kit.name === 'string' &&
    Array.isArray(kit.sections) &&
    typeof kit.files?.['index.tsx'] === 'string' &&
    typeof kit.examples === 'object' &&
    kit.cover !== undefined;
  if (!isWhole) fail(`${path} is damaged: it does not hold version ${version} of ${values.kit}.`);
  return kit;
}

// The previous export stays until the new one is in place, so a failed move can put it back.
function publish() {
  if (existsSync(presetDir)) renameSync(presetDir, previous);
  try {
    renameSync(staging, presetDir);
  } catch (error) {
    try {
      if (existsSync(previous)) renameSync(previous, presetDir);
    } catch (restoreError) {
      fail(
        `Could not publish the export (${error.message}) or put the previous one back (${restoreError.message}). ` +
          `Move ${previous} back to ${presetDir}; the new export is in ${staging}.`,
      );
    }
    fail(`Could not publish the export (${error.message}). The preset is unchanged; the new export is in ${staging}.`);
  }
  rmSync(previous, { recursive: true, force: true });
}

function existingName() {
  const path = join(presetDir, 'system.json');
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')).name;
}

function copyCaptures() {
  const cover = [];
  for (const mode of ['light', 'dark']) {
    const from = join(kitDir, `${version}.cover-${mode}.png`);
    if (system.cover === null || !existsSync(from)) continue;
    cpSync(from, join(staging, `cover-${mode}.png`));
    cover.push(mode);
  }
  const previewsDir = join(kitDir, `${version}.previews`);
  const captures = existsSync(previewsDir)
    ? readdirSync(previewsDir).filter((entry) => CAPTURE.test(entry))
    : [];
  for (const entry of captures) cpSync(join(previewsDir, entry), join(staging, 'previews', entry));

  const missing = [];
  if (system.cover !== null)
    for (const mode of ['light', 'dark']) if (!cover.includes(mode)) missing.push(`cover ${mode}`);
  for (const section of system.sections)
    for (const item of section.items) {
      if (item.kind !== 'preview') continue;
      for (const mode of ['light', 'dark'])
        if (!captures.includes(`${item.id}-${mode}.png`)) missing.push(`${item.id} ${mode}`);
    }
  return { cover, previews: captures.length, missing };
}
