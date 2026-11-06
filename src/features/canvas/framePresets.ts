// The screens a design is usually built for, which a frame can be set to in
// one step instead of typing its size.

export type PresetGroup = 'Phone' | 'Tablet' | 'Desktop';

export interface FramePreset {
  name: string;
  group: PresetGroup;
  width: number;
  height: number;
}

export const PRESET_GROUPS: readonly PresetGroup[] = ['Phone', 'Tablet', 'Desktop'];

/** CSS pixel viewports, portrait for handheld screens; a swap turns one to landscape. */
export const FRAME_PRESETS: readonly FramePreset[] = [
  { name: 'Phone', group: 'Phone', width: 393, height: 852 },
  { name: 'Small phone', group: 'Phone', width: 375, height: 667 },
  { name: 'Android', group: 'Phone', width: 360, height: 800 },
  { name: 'Tablet', group: 'Tablet', width: 768, height: 1024 },
  { name: 'Large tablet', group: 'Tablet', width: 1024, height: 1366 },
  { name: 'Laptop', group: 'Desktop', width: 1280, height: 832 },
  { name: 'Desktop', group: 'Desktop', width: 1440, height: 900 },
  { name: 'Full HD', group: 'Desktop', width: 1920, height: 1080 },
];
