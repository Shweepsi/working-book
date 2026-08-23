import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

// Service-worker plumbing, in three pieces:
//
//  - the registration itself, with `registerType: 'prompt'` (see vite.config):
//    a new worker installs in the background and then *waits*, so nobody gets
//    reloaded in the middle of a test QC. The operator decides when.
//  - a periodic re-check, because the tablet on the line is never closed: the
//    browser only looks for a new worker on navigation, so an app left open
//    for three days would never learn a version had shipped.
//  - a tiny store, so the Réglages panel can say « à jour » or « mise à jour
//    prête » and offer the button — the prompt can be dismissed, or land while
//    nobody is holding the tablet; the panel is there whenever someone comes
//    back from the coater and wonders which version they are looking at.

// Half an hour between automatic checks. The request is a conditional GET on
// sw.js; the cost is nil, and a shift is eight hours long — anything rarer and
// a fix shipped at 6h is still not on the tablet at 14h.
const CHECK_INTERVAL_MS = 30 * 60_000;
// Foreground checks (screen unlocked, tab brought back) share this floor so
// flipping between tabs doesn't hammer the network.
const MIN_GAP_MS = 5 * 60_000;

/** What a check could conclude. `unsupported` covers the plain-browser case. */
export type UpdateCheck = 'ready' | 'up-to-date' | 'offline' | 'error' | 'unsupported';

let applySW: ((reload?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | undefined;
let lastCheckAt = 0;
let updateWaiting = false;

const listeners = new Set<() => void>();

function setWaiting(next: boolean): void {
  if (updateWaiting === next) return;
  updateWaiting = next;
  listeners.forEach((l) => l());
}

function subscribeUpdateWaiting(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isUpdateWaiting(): boolean {
  return updateWaiting;
}

/** Whether a new version is parked, waiting for someone to say when. */
export function useUpdateWaiting(): boolean {
  return useSyncExternalStore(subscribeUpdateWaiting, isUpdateWaiting, isUpdateWaiting);
}

function supported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator;
}

// Wires the service worker registration with two callbacks:
//  - onNeedRefresh: a new SW is waiting; we surface a toast that lets the
//    operator decide when to reload (instead of blindly skipWaiting in the
//    middle of an edit). Also fires on a worker that was already waiting when
//    the app started, so a missed toast comes back at the next launch. The
//    toast's button calls `applyUpdate` — the same one the Réglages button
//    calls, which is worth being able to see at a glance.
//  - onOfflineReady: first install finished caching; nice-to-know feedback.
export function registerServiceWorker(callbacks: {
  onNeedRefresh: () => void;
  onOfflineReady?: () => void;
}): void {
  if (!supported() || applySW) return;
  applySW = registerSW({
    immediate: false,
    onNeedRefresh() {
      setWaiting(true);
      callbacks.onNeedRefresh();
    },
    onOfflineReady() {
      callbacks.onOfflineReady?.();
    },
    onRegisteredSW(_swUrl, r) {
      registration = r;
      if (r?.waiting) setWaiting(true);
      lastCheckAt = Date.now();
      startWatching();
    },
  });
}

// Two triggers, same guard: the interval for the tablet nobody touches, and
// the return to the foreground for the phone that was in a pocket — a screen
// woken at 6h is the moment to find out about last night's deploy.
function startWatching(): void {
  window.setInterval(() => void check(), CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  window.addEventListener('online', () => void check());
}

// A background check: cheap, silent, and skipped when it can't succeed or has
// just run. The toast comes from the `waiting` event, not from here.
async function check(): Promise<void> {
  if (!registration || updateWaiting) return;
  if (!navigator.onLine) return;
  if (Date.now() - lastCheckAt < MIN_GAP_MS) return;
  lastCheckAt = Date.now();
  try {
    await registration.update();
  } catch {
    /* offline, or the server hiccuped — the next tick tries again */
  }
}

// The Réglages button: forced (no throttle, the operator asked), and it waits
// for the answer instead of returning « à jour » while the new worker is still
// installing — someone standing in front of the panel deserves a verdict.
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!supported()) return 'unsupported';
  if (updateWaiting) return 'ready';
  // Registration is deferred to the window's `load` event, so a press in that
  // first second would otherwise be answered « pas de worker ici » and cost a
  // pointless reload. Ask the browser rather than our own callback.
  if (!registration) registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return 'unsupported';
  if (!navigator.onLine) return 'offline';
  lastCheckAt = Date.now();
  const activeBefore = registration.active;
  try {
    await registration.update();
  } catch {
    // Wi-Fi captif de l'atelier, Worker qui tousse: on ne sait pas. Le dire,
    // plutôt que répondre « à jour » à quelqu'un qui attend un correctif.
    return navigator.onLine ? 'error' : 'offline';
  }
  // Either the new worker parked itself, or — page not controlled yet — it
  // simply took the place of the old one. Both mean the same thing to the
  // person in front of the screen: what you are looking at is the old version.
  const stale = (await settled(registration)) || registration.active !== activeBefore;
  if (stale) setWaiting(true);
  return stale ? 'ready' : 'up-to-date';
}

// `update()` resolves once the new worker is *found*, not once it is installed.
// Follow the install to its end so the caller learns the truth.
function settled(r: ServiceWorkerRegistration): Promise<boolean> {
  if (r.waiting) return Promise.resolve(true);
  const installing = r.installing;
  if (!installing) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    installing.addEventListener('statechange', function onState() {
      if (installing.state === 'installing') return;
      installing.removeEventListener('statechange', onState);
      resolve(r.waiting != null);
    });
  });
}

/**
 * Hand the page over to the new version.
 *
 * The normal path is skipWaiting on the worker that is parked, and the reload
 * that follows comes from the `controlling` event inside vite-plugin-pwa's
 * client. But there is a case where nothing is parked at all: on the very first
 * visit the page isn't controlled by any worker, so a version that ships during
 * that session installs and takes over on the spot — the prompt appears (the
 * code on screen *is* stale) with no waiting worker to wake. skipWaiting there
 * messages nobody and the button does nothing; a plain reload is the update.
 *
 * The timer is the same insurance seen from the other side: whatever happens to
 * the message, this ends on a reload. A button called « Mettre à jour » that
 * leaves the operator looking at the old version is the one outcome to rule out.
 */
export function applyUpdate(): void {
  if (!applySW || !registration?.waiting) {
    window.location.reload();
    return;
  }
  void applySW(true);
  window.setTimeout(() => window.location.reload(), 3_000);
}
