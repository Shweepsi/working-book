import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// What the Réglages panel prints under « Version ». Diagnosing a stale tablet
// over the phone used to be impossible — nothing in the UI said which build was
// running. The commit is what CI stamps (GitHub Actions sets GITHUB_SHA,
// Cloudflare Pages sets CF_PAGES_COMMIT_SHA); a local `npm run build` says
// "local", which is itself the answer to "tu es sur quelle version ?".
const commit = (process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? '').slice(0, 7);

// The commit's own date, not the moment of the build. A timestamp would make
// every CI run produce different bytes, so re-running a deploy on an unchanged
// commit would hash a new bundle, ship a new worker, and ask every tablet on
// the line to update for nothing — which is also why the fallback is an empty
// stamp rather than the clock: where there is no git (a source tarball, a
// shallow checkout), « pas de date » is honest, a fresh timestamp is the very
// churn this avoids. Only `vite build` pays for the subprocess; the dev server
// reloads this file often and nobody reads the stamp there.
function stamp(command: string): string {
  if (command !== 'build') return '';
  try {
    return execSync('git log -1 --format=%cI', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export default defineConfig(({ command }) => ({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit || 'local'),
    __APP_BUILT_AT__: JSON.stringify(stamp(command)),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'icon.svg'],
      manifest: {
        id: '/',
        name: 'Working Book',
        short_name: 'Logbook',
        description: 'Logbook de poste et tests production pour le coater.',
        lang: 'fr',
        dir: 'ltr',
        categories: ['productivity', 'business'],
        theme_color: '#f0eee9',
        background_color: '#f0eee9',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
}));
