import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-remote', import.meta.url)),
  plugins: [react()],
  server: { port: 1421, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
