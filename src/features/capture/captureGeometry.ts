import type { CaptureRect, CaptureRegion } from './types';

export function clampCrop(rect: CaptureRect, width: number, height: number): CaptureRect {
  if (![rect.x, rect.y, rect.width, rect.height, width, height].every(Number.isFinite)) {
    throw new Error('Capture coordinates must be finite.');
  }
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
  if (right <= left || bottom <= top) throw new Error('Select an area inside the image.');
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function regionsAtPoint(regions: CaptureRegion[], x: number, y: number): CaptureRegion[] {
  return regions.filter(({ rect }) => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height)
    .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
}

// Only snap a nearly matching rectangle. Background color alone is never a mask.
export function snapCrop(rect: CaptureRect, regions: CaptureRegion[], tolerance: number): CaptureRect {
  const edgeDistance = (other: CaptureRect) => Math.max(
    Math.abs(rect.x - other.x), Math.abs(rect.y - other.y),
    Math.abs(rect.x + rect.width - other.x - other.width),
    Math.abs(rect.y + rect.height - other.y - other.height),
  );
  const match = regions.filter(({ rect: other }) => edgeDistance(other) <= tolerance)
    .sort((a, b) => edgeDistance(a.rect) - edgeDistance(b.rect))[0];
  return match?.rect ?? rect;
}

// Analyze a small proxy only; the renderer always crops the original bitmap.
// Long, coherent edges suggest panels/rows. They do not imply semantic recognition.
export function detectImageRegions(image: ImageData, originalWidth: number, originalHeight: number): CaptureRegion[] {
  const { data, width, height } = image;
  const difference = (a: number, b: number) => Math.max(
    Math.abs(data[a] - data[b]), Math.abs(data[a + 1] - data[b + 1]), Math.abs(data[a + 2] - data[b + 2]),
  );
  const cuts = (vertical: boolean, start: number, end: number) => {
    const limit = vertical ? width : height;
    const found = [0];
    for (let axis = 2; axis < limit - 2; axis++) {
      let coherent = 0;
      let samples = 0;
      for (let cross = start; cross < end; cross += 3) {
        const offset = vertical ? (cross * width + axis) * 4 : (axis * width + cross) * 4;
        const previous = offset - (vertical ? 4 : width * 4);
        if (difference(offset, previous) > 13) coherent++;
        samples++;
      }
      if (samples > 4 && coherent / samples > 0.62 && axis - found[found.length - 1] > 12) found.push(axis);
    }
    found.push(limit);
    return found;
  };
  const columns = cuts(true, 0, height);
  const regions: CaptureRegion[] = [];
  const add = (x: number, y: number, w: number, h: number, label: string) => {
    if (w < 35 || h < 18 || w * h >= width * height * 0.98) return;
    const rect = clampCrop({ x: x * originalWidth / width, y: y * originalHeight / height,
      width: w * originalWidth / width, height: h * originalHeight / height }, originalWidth, originalHeight);
    regions.push({ label, rect, source: 'edges' });
  };
  for (let column = 0; column < columns.length - 1 && regions.length < 160; column++) {
    const x = columns[column];
    const w = columns[column + 1] - x;
    add(x, 0, w, height, 'Detected panel');
    const rows = cuts(false, x, x + w);
    for (let row = 0; row < rows.length - 1 && regions.length < 160; row++) {
      add(x, rows[row], w, rows[row + 1] - rows[row], 'Detected section');
    }
  }
  return regions;
}

export function collectComponentRegions(): { width: number; height: number; regions: CaptureRegion[] } {
  const regions: CaptureRegion[] = [];
  for (const element of document.querySelectorAll<HTMLElement>('[data-capture-region]')) {
    const box = element.getBoundingClientRect();
    if (box.width < 12 || box.height < 12 || box.right <= 0 || box.bottom <= 0 || box.left >= innerWidth || box.top >= innerHeight) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    regions.push({ label: element.dataset.captureRegion || 'Component', source: 'component',
      rect: clampCrop(box, innerWidth, innerHeight) });
  }
  return { width: innerWidth, height: innerHeight, regions };
}
