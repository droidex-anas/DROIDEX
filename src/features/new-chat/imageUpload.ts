import { fitWithin } from '../../lib/images';

// Uploads persist in localStorage, so they are re-encoded at a bounded size
// first: a full-resolution photo would blow through the storage quota.
export async function imageFileToDataUrl(
  file: File,
  maxSide: number,
  type: 'image/jpeg' | 'image/png',
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const size = fitWithin({ width: bitmap.width, height: bitmap.height }, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return canvas.toDataURL(type, 0.86);
  } finally {
    bitmap.close();
  }
}
