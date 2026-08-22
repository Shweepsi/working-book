/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Build stamp, injected by `define` in vite.config.ts and read by Réglages.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;
