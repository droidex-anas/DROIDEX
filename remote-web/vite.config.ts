import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import { fileURLToPath } from 'node:url';
import desktopTailwind from '../tailwind.config.js';

const BASE = '/__droidex_remote/';

// Mirrors vercel.json in development: every top-level route is the app, and the
// worker under BASE may control the whole origin.
function productionRoutes(): Plugin {
  return {
    name: 'droidex-production-routes',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? '/';
        if (url.startsWith(`${BASE}sw.js`)) response.setHeader('Service-Worker-Allowed', '/');
        else if (!url.startsWith(BASE)) request.url = BASE;
        next();
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: BASE,
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-remote', import.meta.url)),
  plugins: [react(), productionRoutes()],
  // The browser bundle also carries the pairing screens, whose classes must
  // stay out of the desktop renderer's CSS budget.
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          ...desktopTailwind,
          content: [...desktopTailwind.content, './remote-web/src/**/*.{ts,tsx}'],
        }),
        autoprefixer(),
      ],
    },
  },
  resolve: {
    alias: [
      {
        find: /^@droidex\/icons$/,
        replacement: fileURLToPath(new URL('../packages/icons/src/index.ts', import.meta.url)),
      },
    ],
  },
  server: { port: 1421, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});
