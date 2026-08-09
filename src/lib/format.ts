// Number and stamp formats shared by the schedule's two printouts.
//
// They are read side by side by the same people: a thousands separator or a
// date written one way on the detailed sheet and another on the récap reads as
// two different reports. Both were spelled out twice, once per component, and
// had already drifted — one of the two copies grew a guard against a missing
// number, the other didn't.

/** fr-FR, fixed decimals. Anything unusable prints as nothing rather than as "NaN". */
export function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** "08/08/2026 06:12" — the provenance stamp both sheets open on. */
export function fmtStamp(when: string | number | Date): string {
  return new Date(when).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
