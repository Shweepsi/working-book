export function fmtHM(date: Date = new Date()): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

const HM_RE = /^(\d{1,2}):(\d{2})$/;

export function parseHM(value: string | null | undefined): number | null {
  const match = HM_RE.exec(value || '');
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function diffMinutes(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const a = parseHM(start);
  const b = parseHM(end);
  if (a === null || b === null) return null;
  let d = b - a;
  if (d < 0) d += 24 * 60;
  return d;
}

export function fmtDuration(min: number | null | undefined): string {
  if (min == null) return '—';
  if (min < 60) return `${min}′`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

export function liveDurationSince(
  startHM: string,
  now: Date = new Date(),
): number | null {
  const start = parseHM(startHM);
  if (start === null) return null;
  const cur = now.getHours() * 60 + now.getMinutes();
  let d = cur - start;
  if (d < 0) d += 24 * 60;
  return d;
}
