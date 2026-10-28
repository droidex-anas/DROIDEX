import { loadCustomThemes, loadTheme } from '../../src/hooks/persistedThemePreferences';
import { applyTheme, BUILT_IN_THEMES, resolveScheme } from '../../src/lib/theme';
import { LAST_HANDLE_KEY } from './deviceStore';

export const lightScheme = window.matchMedia('(prefers-color-scheme: light)');

/** The default DROIDEX look in the system's current scheme, for screens outside the app. */
export function applySystemTheme(): void {
  const colors = lightScheme.matches ? BUILT_IN_THEMES[0].light : BUILT_IN_THEMES[0].dark;
  applyTheme({
    ...colors,
    diffStyle: 'soft',
    uiFont: 'system',
    uiFontSize: 15,
    codeFontSize: 13,
    translucentSidebar: false,
    contrast: 100,
  });
  document.documentElement.style.colorScheme = lightScheme.matches ? 'light' : 'dark';
}

/**
 * The theme this browser last opened the laptop's app with, so the screens
 * shown while reconnecting look like the app they open into. A browser that
 * has never been let in keeps the system look.
 */
export function applyLaptopTheme(handle: string): void {
  if (localStorage.getItem(LAST_HANDLE_KEY) !== handle) return;
  const theme = loadTheme(loadCustomThemes());
  applyTheme(theme);
  document.documentElement.style.colorScheme = resolveScheme(theme.mode);
}
