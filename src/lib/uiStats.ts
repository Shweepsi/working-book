// Anonymous usage counters: what was done (a closed list the Worker checks) and on
// what kind of device, nothing else — no user, no shift (worker/migrations/0014).
// Fire and forget: a counter that doesn't go through is just not counted.

import { API_BASE, SYNC_ENABLED } from './api';

export type StatEvent = 'open:defects' | 'open:dims' | 'rotate:defects' | 'rotate:dims';

// « touch » is the primary pointer being a finger: a tablet with a mouse counts as a PC.
const device = () => {
  try {
    return window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'pc';
  } catch {
    return 'pc';
  }
};

export function track(feature: 'bilan-table', event: StatEvent): void {
  if (!SYNC_ENABLED) return;
  try {
    void fetch(`${API_BASE}/api/stats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature, event, device: device() }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* not counted */
  }
}
