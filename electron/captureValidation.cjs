const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const PRESETS = ['ember', 'tide', 'pearl', 'iris', 'graphite', 'transparent'];
const DEFAULT_PREFERENCES = {
  presentation: { preset: 'ember', padding: 10, radius: 16, shadow: 35, texture: 8 },
  sound: true, smartSelection: true, shortcutEnabled: true,
};
function bounded(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}.`);
  return value;
}
function validatePresentation(value) {
  if (!value || !PRESETS.includes(value.preset)) throw new Error('Unknown screenshot background.');
  return { preset: value.preset, padding: bounded(value.padding, 0, 40, 'padding'),
    radius: bounded(value.radius, 0, 80, 'corner radius'), shadow: bounded(value.shadow, 0, 70, 'shadow'),
    texture: bounded(value.texture, 0, 30, 'texture') };
}
function validatePreferences(value) {
  for (const key of ['sound', 'smartSelection', 'shortcutEnabled']) {
    if (typeof value?.[key] !== 'boolean') throw new Error(`Invalid capture preference: ${key}.`);
  }
  return { presentation: validatePresentation(value.presentation), sound: value.sound,
    smartSelection: value.smartSelection, shortcutEnabled: value.shortcutEnabled };
}
function validateRecipe(value, width, height) {
  const crop = value?.crop;
  if (!crop) throw new Error('A screenshot crop is required.');
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isSafeInteger(crop[key])) throw new Error('Crop coordinates must be integer source pixels.');
  }
  if (crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1 || crop.x + crop.width > width || crop.y + crop.height > height) throw new Error('Crop lies outside the original screenshot.');
  return { crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height }, presentation: validatePresentation(value.presentation) };
}
function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.length > MAX_IMAGE_BYTES || !buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || buffer.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Capture must be a PNG under 40 MiB.');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 48_000_000) throw new Error('Capture exceeds the 48 megapixel limit.');
  return { width, height };
}
function decodePng(value) {
  const prefix = 'data:image/png;base64,';
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > prefix.length + 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) throw new Error('Invalid PNG payload.');
  const encoded = value.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid PNG encoding.');
  const buffer = Buffer.from(encoded, 'base64');
  pngDimensions(buffer);
  return buffer;
}
const toDataUrl = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
module.exports = { MAX_IMAGE_BYTES, DEFAULT_PREFERENCES, validatePreferences, validateRecipe, decodePng, pngDimensions, toDataUrl };
