// Which deployment this bundle was built for. CI derives VITE_CHANNEL from the
// branch exactly like VITE_API_URL: `main` ships the production Worker, every
// other branch and PR ships the dev Worker into a Pages preview. So "dev
// channel" and "talking to the dev Worker" are the same thing by construction.
//
// Unset means a hand-rolled build: `vite dev` is a developer at a keyboard, and
// anything else is treated as production. The flag only ever hides work in
// progress, and showing it to the plant by accident is the worse mistake.
const RAW = (import.meta.env.VITE_CHANNEL ?? '').trim();

// Three modes:
// - Dev: preview builds (dev Worker and D1), everything shown, template editable.
// - Avancé: a production build after seven taps on the version in Réglages;
//   adds Suivi, its Bilan and the Style choice, on the real data. Per device,
//   read once at load, so toggling reloads the app.
// - Standard: a production build otherwise, Schedule only.
export const IS_DEV_BUILD: boolean = RAW ? RAW === 'dev' : import.meta.env.DEV;

const ADVANCED_KEY = 'wb.advanced';
function readAdvanced(): boolean {
  try {
    return localStorage.getItem(ADVANCED_KEY) === '1';
  } catch {
    return false;
  }
}
export const ADVANCED = !IS_DEV_BUILD && readAdvanced();

/** Avancé features are on: mode Avancé, or a Dev build (which has them all). */
export const SHOWS_ADVANCED: boolean = IS_DEV_BUILD || ADVANCED;

export function setAdvanced(on: boolean): void {
  try {
    if (on) localStorage.setItem(ADVANCED_KEY, '1');
    else localStorage.removeItem(ADVANCED_KEY);
  } catch {
    /* storage blocked: nothing to persist */
  }
  location.reload();
}
