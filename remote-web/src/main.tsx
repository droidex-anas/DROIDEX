import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, BUILT_IN_THEMES } from '../../src/lib/theme';
import { App } from './App';
import './styles.css';

const preference = window.matchMedia('(prefers-color-scheme: light)');
function applySystemTheme() {
  const colors = preference.matches ? BUILT_IN_THEMES[0].light : BUILT_IN_THEMES[0].dark;
  applyTheme({
    ...colors,
    diffStyle: 'soft',
    uiFont: 'system',
    uiFontSize: 15,
    codeFontSize: 13,
    translucentSidebar: false,
    contrast: 100,
  });
  document.documentElement.style.colorScheme = preference.matches ? 'light' : 'dark';
}
applySystemTheme();
preference.addEventListener('change', applySystemTheme);

const root = document.getElementById('root');
if (!root) throw new Error('DROIDEX Remote is missing its root element.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    console.warn('DROIDEX Remote could not register its app worker.');
  });
}
