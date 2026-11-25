import { useEffect } from 'react';
import { setAppIcon } from '../lib/desktop';
import { applyTheme, findPreset, resolveVariant } from '../lib/theme';
import { useStoreDispatch, useStoreSelector } from './useStore';

export function useThemeSync(embedded: boolean): void {
  const theme = useStoreSelector((state) => state.theme);
  const customThemes = useStoreSelector((state) => state.customThemes);
  const dispatch = useStoreDispatch();

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (embedded) return;
    void setAppIcon(theme.appIconMode).catch((error: unknown) => {
      console.error('Failed to update app icon', error);
    });
  }, [embedded, theme.appIconMode]);

  useEffect(() => {
    if (theme.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      // Follow the OS scheme with the active preset's matching variant.
      // Hand-edited (custom) colors have no second variant, so they stay put.
      const preset = findPreset(theme.presetId, customThemes);
      if (preset) dispatch({ type: 'SET_THEME', theme: resolveVariant(preset, 'system') });
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
    };
  }, [theme.mode, theme.presetId, customThemes, dispatch]);
}
