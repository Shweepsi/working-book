// Parser for the PMS230 "Post Production Report" Ctrl+A/Ctrl+C clipboard payload.
//
// Two paths:
//  1. HTML clipboard ("text/html") — we walk the DOM rows directly. Reliable.
//  2. Plain text fallback — every cell lands on its own line; we anchor on the
//     10-digit schedule pattern (`/^22\d{8}$/`) and decode each record positionally
//     with strict type guards so a missing field can't silently drift the row.

const SCHEDULE_RE = /^22\d{8}$/;
const MO_RE       = /^1\d{9}$/;
const PRODUCT_RE  = /^33\d{7}$/;
const DATE_RE     = /^\d{8}$/;
const TIME_RE     = /^\d{2}:\d{2}$/;
const SHORT_INT_RE = /^\d{1,4}$/;
const DECIMAL_RE  = /^\d+\.\d{2}$/;
const THICKNESS_RE = /^\d{2}\.\d{2}$/;
const INCHES_RE   = /\s\d+\/\d+$/; // "126 3/8", "236 7/32"
const PAGE_RE     = /^Page\s+(\d+)\s+of\s+(\d+)$/;

const NOISE_LINES = new Set([
  'Facility', 'Work Center', 'From Start Date', 'To Start Date',
  'Search', 'PMS230Export PDF', 'Post Production Report',
  'First PagePrevious Page', 'Next PageLast Page',
  'Quality Group Description', 'Perim Treatment', 'Separator',
  'Logo Placement', 'Protective Backing', 'Draw Lines',
  'Thickness Tolerance', 'Rack', 'Customer Specific Text',
  'Metric Tons', 'Square Meters', 'Packs', 'Square Feet', 'Pounds (LBS)',
  'Sorting order', 'To Location', 'Create RO',
  'No Matching Product Items Found', 'Page',
]);

const NOISE_PATTERNS = [
  /^release\//,
  /^\d+\s+Records per page$/,
];

function normalise(text) {
  // Strip NBSP / ZWSP / BOM, collapse to LF.
  return text
    .replace(/﻿/g, '')
    .replace(/[ ​]/g, ' ')
    .replace(/\r\n?/g, '\n');
}

function isNoise(line) {
  if (NOISE_LINES.has(line)) return true;
  return NOISE_PATTERNS.some((re) => re.test(line));
}

// --- HTML path ---------------------------------------------------------------

function parseHTMLPayload(html) {
  if (!html || typeof DOMParser === 'undefined') return null;
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  // PMS230 is div-based, not <table>. We can't reliably identify rows from HTML
  // structure alone, so we extract all cell-like text and feed it back through
  // the plain-text path. This still benefits from HTML's accurate cell
  // separation (whitespace inside a cell stays inside one line).
  const text = doc.body?.innerText ?? doc.documentElement.textContent ?? '';
  if (!text.trim()) return null;
  return text;
}

// --- Plain-text tokenisation -------------------------------------------------

function tokenise(text) {
  return normalise(text)
    .split('\n')
    .map((l) => l.replace(/\t/g, ' ').trim())
    .filter(Boolean)
    .filter((l) => !isNoise(l));
}

function findScheduleAnchors(tokens) {
  // The schedule pattern (10 digits, starts with "22") is specific enough that
  // false positives are negligible: MOs start with 1, products with 33, dates
  // are 8 digits, and customer names don't contain bare 10-digit numbers.
  const anchors = [];
  for (let i = 0; i < tokens.length; i++) {
    if (SCHEDULE_RE.test(tokens[i])) anchors.push(i);
  }
  return anchors;
}

function findPageInfo(tokens) {
  // The "Page X of Y" footer often arrives split across three tokens:
  // "Page", "1", "of 4" — or as one combined string. Handle both.
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i].match(PAGE_RE);
    if (m) return { currentPage: +m[1], totalPages: +m[2] };
    if (tokens[i] === 'Page' && /^\d+$/.test(tokens[i + 1])) {
      const tail = tokens[i + 2] ?? '';
      const m2 = tail.match(/^of\s+(\d+)$/) || tail.match(/^(\d+)$/);
      if (m2) return { currentPage: +tokens[i + 1], totalPages: +m2[1] };
    }
  }
  return { currentPage: null, totalPages: null };
}

function decodeRecord(slice, warnings, recordIdx) {
  // Return null for unrecoverable rows; the caller will skip them.
  if (slice.length < 13) {
    warnings.push(`Record ${recordIdx}: only ${slice.length} fields, skipping`);
    return null;
  }

  const r = {
    schedule: slice[0],
    schedSuffix: slice[1] ?? '0',
    opSteps: [slice[2], slice[3], slice[4]].filter(Boolean).join('/'),
    workCenter: slice[5] ?? '',
    startDate: slice[6] ?? '',
    startTime: slice[7] ?? '',
    endDate: slice[8] ?? '',
    endTime: slice[9] ?? '',
    dateDepart: null,
    mo: '',
    product: '',
    itemName: '',
    schedLites: 0,
    prodLites: 0,
    reqLites: 0,
    scraps: 0,
    largeur: 0,
    longueur: 0,
    qualite: '',
    litesPerPack: null,
    pdp: '',
    formatCode: '',
    largeurInch: '',
    longueurInch: '',
    thickness: '',
    customer: '',
  };

  let i = 10;

  // Optional Date Départ — present if it's an 8-digit date AND the *next* token
  // is an MO (10-digit starting with 1). Otherwise the next token is the MO itself.
  if (DATE_RE.test(slice[i] ?? '') && MO_RE.test(slice[i + 1] ?? '')) {
    r.dateDepart = slice[i];
    i++;
  }

  if (!MO_RE.test(slice[i] ?? '')) {
    warnings.push(`Record ${recordIdx} (sched ${r.schedule}): expected MO at position ${i}, got "${slice[i]}"`);
    return null;
  }
  r.mo = slice[i++];

  if (!PRODUCT_RE.test(slice[i] ?? '')) {
    warnings.push(`Record ${recordIdx} (sched ${r.schedule}): expected product code at position ${i}, got "${slice[i]}"`);
    return null;
  }
  r.product = slice[i++];

  // Item name — must start with a letter. Item names with dots like
  // "CSGSN51XC10005.5.2CL" are fine; the strict integer guard below rejects them.
  if (!/^[A-Z]/.test(slice[i] ?? '')) {
    warnings.push(`Record ${recordIdx} (sched ${r.schedule}): expected item name at position ${i}, got "${slice[i]}"`);
    return null;
  }
  r.itemName = slice[i++];

  // Sched / Prod / Req lites — strict short integers. If any guard fails, push
  // a warning and stop decoding the rest of the optional tail.
  if (!SHORT_INT_RE.test(slice[i] ?? '')) {
    warnings.push(`Record ${recordIdx} (sched ${r.schedule}): expected schedLites integer at position ${i}, got "${slice[i]}"`);
    return r;
  }
  r.schedLites = parseInt(slice[i++], 10);

  if (SHORT_INT_RE.test(slice[i] ?? '')) r.prodLites = parseInt(slice[i++], 10);
  if (SHORT_INT_RE.test(slice[i] ?? '')) r.reqLites  = parseInt(slice[i++], 10);

  if (DECIMAL_RE.test(slice[i] ?? '')) r.scraps = parseFloat(slice[i++]);
  if (slice[i] === '0') i++; // filler

  if (DECIMAL_RE.test(slice[i] ?? '')) r.largeur = parseFloat(slice[i++]);
  if (DECIMAL_RE.test(slice[i] ?? '')) r.longueur = parseFloat(slice[i++]);

  // QC samples have largeur=longueur=0 and end here.
  if (r.largeur === 0 && r.longueur === 0) {
    return r;
  }

  // Optional trailing block: qualité, lites/packs, pdp, format, inches, thickness, customer.
  if (i < slice.length && /^[A-Z]/.test(slice[i]) && !/\d/.test(slice[i])) {
    r.qualite = slice[i++];
  } else if (i < slice.length && /^[A-Z]+\d*$/.test(slice[i])) {
    // Allow qualité like "NEX9", "UC", "XC".
    r.qualite = slice[i++];
  }

  if (SHORT_INT_RE.test(slice[i] ?? '')) {
    r.litesPerPack = parseInt(slice[i++], 10);
  }

  // PDP starts with "O" (single letter or "O PL6", "O SP3 PL6", "O PL44.2").
  // Consume until we hit the format code (`I11L`, `ILLT1`) or inches dimension or thickness.
  const pdpParts = [];
  while (i < slice.length) {
    const t = slice[i];
    if (
      /^I[A-Z0-9]+L?$/.test(t) && t !== 'O' && t.length >= 4 ||  // I11L, ILLT1
      INCHES_RE.test(t) ||
      THICKNESS_RE.test(t)
    ) break;
    pdpParts.push(t);
    i++;
  }
  r.pdp = pdpParts.join(' ');

  if (i < slice.length && /^I[A-Z0-9]+L?$/.test(slice[i])) {
    r.formatCode = slice[i++];
  }
  if (i < slice.length && INCHES_RE.test(slice[i])) {
    r.largeurInch = slice[i++];
  }
  if (i < slice.length && INCHES_RE.test(slice[i])) {
    r.longueurInch = slice[i++];
  }
  if (i < slice.length && THICKNESS_RE.test(slice[i])) {
    r.thickness = slice[i++];
  }
  if (i < slice.length) {
    // Anything left is the customer name (joined in case it contains spaces
    // that survived earlier `.trim()` since clipboard cells preserve internal
    // whitespace as-is on a single line).
    r.customer = slice.slice(i).join(' ').trim();
  }

  return r;
}

function rowM2(r) {
  return (r.largeur * r.longueur * r.schedLites) / 1_000_000;
}

function itemRoot(itemName) {
  // CSGSN51XC0400 -> CSGSN51, CSGSN70/35XC0600 -> CSGSN70/35
  const m = itemName.match(/^([A-Z]+\d+(?:\/\d+)?)/);
  return m ? m[1] : '';
}

function dominantItemRoot(records) {
  // Pick the root that covers the most rows among glass records (skip QC samples).
  const counts = new Map();
  for (const r of records) {
    if (r.largeur === 0 && r.longueur === 0) continue;
    const root = itemRoot(r.itemName);
    if (!root) continue;
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [root, n] of counts) {
    if (n > bestCount) { best = root; bestCount = n; }
  }
  return best || itemRoot(records[0]?.itemName ?? '') || '';
}

function summariseSchedules(records) {
  const groups = new Map();
  for (const r of records) {
    if (!r) continue;
    if (!groups.has(r.schedule)) groups.set(r.schedule, []);
    groups.get(r.schedule).push(r);
  }
  return Array.from(groups, ([schedule, rows]) => ({
    schedule,
    itemRoot: dominantItemRoot(rows),
    totalM2: rows.reduce((s, r) => s + r.m2, 0),
    totalLites: rows.reduce((s, r) => s + r.schedLites, 0),
    recordCount: rows.length,
  }));
}

export function parsePMS230(textOrPayload) {
  const html = typeof textOrPayload === 'object' ? textOrPayload.html : null;
  const raw  = typeof textOrPayload === 'object' ? textOrPayload.text : textOrPayload;

  // Try HTML first; if it yields more usable text, prefer it.
  let source = raw ?? '';
  if (html) {
    const fromHtml = parseHTMLPayload(html);
    if (fromHtml && fromHtml.trim().length > source.trim().length) source = fromHtml;
  }

  const tokens = tokenise(source);
  const warnings = [];
  const { currentPage, totalPages } = findPageInfo(tokens);
  const anchors = findScheduleAnchors(tokens);
  const records = [];

  for (let a = 0; a < anchors.length; a++) {
    const start = anchors[a];
    const end = anchors[a + 1] ?? tokens.length;
    const slice = tokens.slice(start, end).filter((t) => !isNoise(t));
    const decoded = decodeRecord(slice, warnings, a);
    if (decoded) {
      decoded.m2 = rowM2(decoded);
      decoded.id = `${decoded.schedule}|${decoded.mo}|${a}`;
      records.push(decoded);
    }
  }

  const schedules = summariseSchedules(records);

  return {
    records,
    schedules,
    warnings,
    currentPage,
    totalPages,
    importedAt: new Date().toISOString(),
  };
}

export function mergePMS230(prev, next) {
  // Append-style merge: dedup on `${schedule}|${mo}`. Records that exist in both
  // are kept from `next` (the fresher paste).
  if (!prev) return next;
  const seen = new Map();
  for (const r of next.records) seen.set(`${r.schedule}|${r.mo}`, r);
  for (const r of prev.records) {
    const k = `${r.schedule}|${r.mo}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  const records = Array.from(seen.values()).sort((a, b) => {
    if (a.schedule !== b.schedule) return a.schedule.localeCompare(b.schedule);
    return a.mo.localeCompare(b.mo);
  });
  return {
    records,
    schedules: summariseSchedules(records),
    warnings: [...(prev.warnings ?? []), ...(next.warnings ?? [])],
    currentPage: next.currentPage ?? prev.currentPage,
    totalPages: next.totalPages ?? prev.totalPages,
    importedAt: next.importedAt,
  };
}
