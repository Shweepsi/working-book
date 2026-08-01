// Unique across devices, not just within one page load. A counter starting at 1
// gave every tab the same `e1`, so the moment two of them wrote to the same
// shift — which is now the normal case, the log being live — React saw
// duplicate keys and a delete by id took both rows with it. Same shape as the
// generators in Suivi and ProductionTest.
export function newId(): string {
  return `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
