// Tiny localStorage helper. Survives reload, drops on parse failure.

export function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Asks the browser not to clear this device's data when space runs short: the
 * edits still waiting for the network and the workbooks kept for offline live
 * in it. Best effort — Chrome and Safari decide on their own (an installed app
 * is granted it), a refusal changes nothing. */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (await navigator.storage?.persisted?.()) return;
    await navigator.storage?.persist?.();
  } catch {
    /* unsupported or refused: same as before */
  }
}

export function save(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or serialization issue — drop silently */
  }
}
