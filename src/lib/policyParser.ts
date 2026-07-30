// Parser for the Item-number / Name / Planning-policy lookup table.
// Source: a 3-column tab-separated paste from a spreadsheet/grid.

export type Policy = 'MTO' | 'MTS' | 'Inactif';

export interface PastePayload {
  html?: string | null;
  text?: string | null;
}

export interface PolicyResult {
  map: Record<string, Policy>;
  names: Record<string, string>;
  count: number;
  warnings: string[];
  importedAt: string;
}

const PRODUCT_RE = /^33\d{7}$/;
const POLICY_VALUES = new Set<Policy>(['MTO', 'MTS', 'Inactif']);
const HEADER_TOKENS = new Set(['Item number', 'Name', 'Planning policy', 'Pp']);

// The export sometimes carries the raw planning-policy code instead of its
// label. Same three states, so both spellings map onto the same `Policy`.
const POLICY_CODES: Record<string, Policy> = {
  '10': 'MTO',
  '50': 'MTS',
  '90': 'Inactif',
};

function normalise(text: string): string {
  return text
    .replace(/﻿/g, '')
    .replace(/[ ​]/g, ' ')
    .replace(/\r\n?/g, '\n');
}

function rowsFromHTML(html: string | null | undefined): string[][] | null {
  if (!html || typeof DOMParser === 'undefined') return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  const rows: string[][] = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = Array.from(tr.querySelectorAll('th, td')).map((c) => (c.textContent ?? '').trim());
    if (cells.length >= 3) rows.push([cells[0]!, cells[1]!, cells[2]!]);
  }
  return rows.length > 0 ? rows : null;
}

function rowsFromText(text: string): string[][] {
  return normalise(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => line.split('\t').map((c) => c.trim()))
    .filter((cells) => cells.length >= 3);
}

// Accepts either the label ("MTO") or the numeric code ("10"), in any case.
function toPolicy(value: string): Policy | null {
  const code = POLICY_CODES[value];
  if (code) return code;
  const upper = value.toUpperCase();
  for (const p of POLICY_VALUES) {
    if (p.toUpperCase() === upper) return p;
  }
  return null;
}

export function parsePolicy(textOrPayload: string | PastePayload): PolicyResult {
  const isPayload = typeof textOrPayload === 'object' && textOrPayload !== null;
  const html = isPayload ? textOrPayload.html ?? null : null;
  const text = isPayload ? textOrPayload.text ?? '' : textOrPayload;

  const rows = rowsFromHTML(html) ?? rowsFromText(text);

  const map: Record<string, Policy> = {};
  const names: Record<string, string> = {};
  const warnings: string[] = [];
  let count = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const productCode = row[0] ?? '';
    const name = row[1] ?? '';
    const policy = row[2] ?? '';

    if (HEADER_TOKENS.has(productCode) || HEADER_TOKENS.has(policy)) continue;

    if (!PRODUCT_RE.test(productCode)) {
      warnings.push(`Row ${i + 1}: invalid product code "${productCode}"`);
      continue;
    }
    const parsed = toPolicy(policy);
    if (!parsed) {
      warnings.push(`Row ${i + 1} (${productCode}): unexpected policy "${policy}"`);
      continue;
    }
    if (map[productCode] && map[productCode] !== parsed) {
      warnings.push(
        `Row ${i + 1}: duplicate ${productCode} with different policy (kept first: ${map[productCode]}, ignored: ${parsed})`,
      );
      continue;
    }
    if (map[productCode]) continue;

    map[productCode] = parsed;
    names[productCode] = name;
    count += 1;
  }

  return {
    map,
    names,
    count,
    warnings,
    importedAt: new Date().toISOString(),
  };
}
