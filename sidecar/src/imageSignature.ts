// The first bytes of the image formats the app can show, so bytes that are not
// an image are reported instead of written out as a file nothing can open. A RIFF
// container is only WebP when it says so at offset 8; the same header fronts
// WAV and AVI.
const SIGNATURES: { extension: string; bytes: number[]; at?: number }[] = [
  { extension: '.png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { extension: '.jpg', bytes: [0xff, 0xd8, 0xff] },
  { extension: '.gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { extension: '.webp', bytes: [0x52, 0x49, 0x46, 0x46] },
  { extension: '.webp', bytes: [0x57, 0x45, 0x42, 0x50], at: 8 },
];

// The extension the bytes themselves call for, or undefined when they are not
// an image this build can show.
export function imageExtension(bytes: Buffer): string | undefined {
  const matches = (signature: (typeof SIGNATURES)[number]) =>
    signature.bytes.every((byte, index) => bytes[(signature.at ?? 0) + index] === byte);
  const riff = SIGNATURES.find((signature) => signature.at === undefined && matches(signature));
  if (riff?.extension !== '.webp') return riff?.extension;
  // RIFF alone is a container, not a picture.
  return SIGNATURES.some((signature) => signature.at === 8 && matches(signature))
    ? '.webp'
    : undefined;
}
