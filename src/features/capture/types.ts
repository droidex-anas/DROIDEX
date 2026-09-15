export type CaptureMode = 'area' | 'window' | 'screen' | 'component';
export type CapturePreset = 'ember' | 'tide' | 'pearl' | 'iris' | 'graphite' | 'transparent';
export interface CaptureRect { x: number; y: number; width: number; height: number }
export interface CapturePresentation {
  preset: CapturePreset;
  padding: number;
  radius: number;
  shadow: number;
  texture: number;
}
export interface CaptureRecipe { crop: CaptureRect; presentation: CapturePresentation }
export interface CapturePreferences {
  presentation: CapturePresentation;
  sound: boolean;
  smartSelection: boolean;
  shortcutEnabled: boolean;
}
export interface CaptureRegion { label: string; rect: CaptureRect; source: 'component' | 'edges' }
export interface CaptureRecord {
  id: string;
  version: number;
  createdAt: number;
  title: string;
  width: number;
  height: number;
  recipe: CaptureRecipe;
  thumbnail: string;
}
export interface CaptureSource { record: CaptureRecord; dataUrl: string }
export interface CaptureAttachment {
  captureId: string;
  path: string;
  preview: string;
  title: string;
}
export interface CaptureApi {
  preferences(): Promise<CapturePreferences & { nativeAvailable: boolean; shortcutRegistered: boolean }>;
  setPreferences(preferences: CapturePreferences): Promise<void>;
  take(mode: CaptureMode, includeApp: boolean): Promise<CaptureSource | null>;
  cancel(): Promise<void>;
  list(): Promise<CaptureRecord[]>;
  open(id: string): Promise<CaptureSource>;
  save(id: string, version: number, recipe: CaptureRecipe, png: string): Promise<CaptureRecord>;
  remove(id: string): Promise<void>;
  attach(id: string, version: number): Promise<CaptureAttachment>;
  copy(id: string, version: number): Promise<void>;
  exportPng(id: string, version: number): Promise<void>;
  onShortcut(handler: () => void): () => void;
}
declare global { interface Window { droidCapture?: CaptureApi } }
export function captureApi(): CaptureApi {
  if (!window.droidCapture) throw new Error('Capture is available in the DROIDEX desktop app.');
  return window.droidCapture;
}
