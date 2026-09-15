import { clampCrop } from './captureGeometry';
import type { CapturePreset, CaptureRecipe } from './types';

export const CAPTURE_PRESETS: { id: CapturePreset; label: string; colors: [string, string, string] }[] = [
  { id: 'ember', label: 'Ember mesh', colors: ['#101014', '#864429', '#432b51'] },
  { id: 'tide', label: 'Halftone tide', colors: ['#061b27', '#21adc4', '#ee6e34'] },
  { id: 'pearl', label: 'Warm pearl', colors: ['#ede7de', '#b7accd', '#edc5a2'] },
  { id: 'iris', label: 'Iris dusk', colors: ['#161422', '#564582', '#2a5771'] },
  { id: 'graphite', label: 'Graphite', colors: ['#151719', '#393e42', '#24292d'] },
  { id: 'transparent', label: 'Transparent', colors: ['#00000000', '#00000000', '#00000000'] },
];

export async function loadCaptureImage(dataUrl: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return image;
}

export function paintCapture(canvas: HTMLCanvasElement, image: HTMLImageElement, recipe: CaptureRecipe, previewLimit?: number): void {
  const crop = clampCrop(recipe.crop, image.naturalWidth, image.naturalHeight);
  const { presentation } = recipe;
  const preset = CAPTURE_PRESETS.find((item) => item.id === presentation.preset);
  if (!preset) throw new Error('Unknown capture background.');
  const padding = Math.round(Math.min(crop.width, crop.height) * presentation.padding / 100);
  const width = crop.width + padding * 2;
  const height = crop.height + padding * 2;
  if (width > 16384 || height > 16384 || width * height > 48_000_000) throw new Error('This composition is too large. Reduce padding or select a smaller area.');
  const scale = previewLimit ? Math.min(1, previewLimit / Math.max(width, height)) : 1;
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create the image canvas.');
  context.scale(scale, scale);
  if (presentation.preset !== 'transparent') {
    context.fillStyle = preset.colors[0];
    context.fillRect(0, 0, width, height);
    for (let index = 1; index <= 2; index++) {
      const x = width * (index === 1 ? 0.1 : 0.95);
      const y = height * (index === 1 ? 0.25 : 0.95);
      const gradient = context.createRadialGradient(x, y, 0, x, y, Math.max(width, height) * 0.9);
      gradient.addColorStop(0, preset.colors[index]);
      gradient.addColorStop(1, `${preset.colors[index]}00`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    }
    if (presentation.texture > 0) {
      const tile = document.createElement('canvas');
      tile.width = tile.height = 8;
      const tileContext = tile.getContext('2d');
      if (tileContext) {
        tileContext.fillStyle = `rgba(255,255,255,${presentation.texture / 100})`;
        tileContext.fillRect(1, 1, 1, 1);
        tileContext.fillStyle = `rgba(0,0,0,${presentation.texture / 100})`;
        tileContext.fillRect(5, 5, 1, 1);
        const pattern = context.createPattern(tile, 'repeat');
        if (pattern) { context.fillStyle = pattern; context.fillRect(0, 0, width, height); }
      }
    }
  }
  const radius = Math.min(presentation.radius, crop.width / 2, crop.height / 2);
  context.save();
  context.shadowColor = `rgba(0,0,0,${presentation.shadow / 100})`;
  context.shadowBlur = Math.min(60, padding * 0.7);
  context.shadowOffsetY = Math.min(18, padding * 0.2);
  context.fillStyle = '#181818';
  context.beginPath();
  context.roundRect(padding, padding, crop.width, crop.height, radius);
  context.fill();
  context.restore();
  context.save();
  context.beginPath();
  context.roundRect(padding, padding, crop.width, crop.height, radius);
  context.clip();
  // At export scale this is a one-to-one source-pixel copy, not a preview upscale.
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, padding, padding, crop.width, crop.height);
  context.restore();
}

export async function renderCapturePng(dataUrl: string, recipe: CaptureRecipe): Promise<string> {
  const image = await loadCaptureImage(dataUrl);
  const canvas = document.createElement('canvas');
  try {
    paintCapture(canvas, image, recipe);
    const png = canvas.toDataURL('image/png');
    if (png === 'data:,') throw new Error('The image could not be encoded.');
    return png;
  } finally { canvas.width = canvas.height = 0; image.src = ''; }
}
