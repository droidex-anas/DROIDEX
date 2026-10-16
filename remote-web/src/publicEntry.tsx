import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicProfile } from './PublicProfile';
import { applySystemTheme, lightScheme } from './systemTheme';
import './styles.css';

export function startPublicProfile(container: HTMLElement, username: string): void {
  applySystemTheme();
  lightScheme.addEventListener('change', applySystemTheme);
  createRoot(container).render(
    <StrictMode>
      <PublicProfile username={username} />
    </StrictMode>,
  );
}
