// Which deployment this bundle was built for. CI derives VITE_CHANNEL from the
// branch exactly like VITE_API_URL: `main` ships the production Worker, every
// other branch and PR ships the dev Worker into a Pages preview. So "dev
// channel" and "talking to the dev Worker" are the same thing by construction.
//
// Unset means a hand-rolled build: `vite dev` is a developer at a keyboard, and
// anything else is treated as production. The flag only ever hides work in
// progress, and showing it to the plant by accident is the worse mistake.
const RAW = (import.meta.env.VITE_CHANNEL ?? '').trim();

const BUILT_DEV: boolean = RAW ? RAW === 'dev' : import.meta.env.DEV;

// Hidden switch: seven taps on the version in Réglages turn dev mode on for this
// device (see Settings). Read once at load, so toggling reloads the app.
const DEV_MODE_KEY = 'wb.devMode';
function readDevMode(): boolean {
  try {
    return localStorage.getItem(DEV_MODE_KEY) === '1';
  } catch {
    return false;
  }
}
export const DEV_MODE_FORCED = !BUILT_DEV && readDevMode();

export const IS_DEV_CHANNEL: boolean = BUILT_DEV || DEV_MODE_FORCED;

// Mode dev on a prod build opens only Suivi (with its Bilan) and the Style
// choice. The rest of the work in progress, and editing the Suivi template,
// stays with the real dev builds, which talk to the dev Worker.
export const FULL_DEV: boolean = BUILT_DEV;

export function setDevMode(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEV_MODE_KEY, '1');
    else localStorage.removeItem(DEV_MODE_KEY);
  } catch {
    /* storage blocked: nothing to persist */
  }
  location.reload();
}
