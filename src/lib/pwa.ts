import { registerSW } from 'virtual:pwa-register';

// Wires the service worker registration with two callbacks:
//  - onNeedRefresh: a new SW is waiting; we surface a toast that lets the
//    operator decide when to reload (instead of blindly skipWaiting in the
//    middle of an edit).
//  - onOfflineReady: first install finished caching; nice-to-know feedback.
//
// Returns the `updateSW` function so the caller can trigger the actual
// reload from a toast action.
export function registerServiceWorker(callbacks: {
  onNeedRefresh: (apply: () => void) => void;
  onOfflineReady?: () => void;
}): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  const updateSW = registerSW({
    immediate: false,
    onNeedRefresh() {
      callbacks.onNeedRefresh(() => {
        void updateSW(true);
      });
    },
    onOfflineReady() {
      callbacks.onOfflineReady?.();
    },
  });
}
