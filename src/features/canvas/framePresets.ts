// The sizes a design is usually built for, which a frame can be set to in one
// step instead of typing its size.

export type PresetGroup = 'Screens' | 'Print' | 'Social' | 'Logo';

export interface FramePreset {
  name: string;
  group: PresetGroup;
  width: number;
  height: number;
}

export const PRESET_GROUPS: readonly PresetGroup[] = ['Screens', 'Print', 'Social', 'Logo'];

/**
 * CSS pixel sizes, portrait for handheld screens and paper; a swap turns one
 * to landscape. Print is at 96 dpi: the export scale carries print resolution.
 */
export const FRAME_PRESETS: readonly FramePreset[] = [
  { name: 'Phone', group: 'Screens', width: 393, height: 852 },
  { name: 'Small phone', group: 'Screens', width: 375, height: 667 },
  { name: 'Android', group: 'Screens', width: 360, height: 800 },
  { name: 'Tablet', group: 'Screens', width: 768, height: 1024 },
  { name: 'Large tablet', group: 'Screens', width: 1024, height: 1366 },
  { name: 'Laptop', group: 'Screens', width: 1280, height: 832 },
  { name: 'Desktop', group: 'Screens', width: 1440, height: 900 },
  { name: 'Full HD', group: 'Screens', width: 1920, height: 1080 },
  { name: 'A4', group: 'Print', width: 794, height: 1123 },
  { name: 'A3', group: 'Print', width: 1123, height: 1587 },
  { name: 'Letter', group: 'Print', width: 816, height: 1056 },
  { name: 'Poster 18 × 24 in', group: 'Print', width: 1728, height: 2304 },
  { name: 'Square', group: 'Social', width: 1080, height: 1080 },
  { name: 'Portrait', group: 'Social', width: 1080, height: 1350 },
  { name: 'Story', group: 'Social', width: 1080, height: 1920 },
  { name: 'Landscape', group: 'Social', width: 1200, height: 630 },
  { name: 'Logo', group: 'Logo', width: 512, height: 512 },
  { name: 'Wide logo', group: 'Logo', width: 1024, height: 320 },
  { name: 'Icon', group: 'Logo', width: 256, height: 256 },
];
