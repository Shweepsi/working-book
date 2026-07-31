// Which deployment this bundle was built for. CI derives VITE_CHANNEL from the
// branch exactly like VITE_API_URL: `main` ships the production Worker, every
// other branch and PR ships the dev Worker into a Pages preview. So "dev
// channel" and "talking to the dev Worker" are the same thing by construction.
//
// Unset means a hand-rolled build: `vite dev` is a developer at a keyboard, and
// anything else is treated as production. The flag only ever hides work in
// progress, and showing it to the plant by accident is the worse mistake.
const RAW = (import.meta.env.VITE_CHANNEL ?? '').trim();

export const IS_DEV_CHANNEL: boolean = RAW ? RAW === 'dev' : import.meta.env.DEV;
