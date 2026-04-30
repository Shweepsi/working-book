// Parser for the Item-number / Name / Planning-policy lookup table.
// Source: a 3-column tab-separated paste from a spreadsheet/grid.
//
// Output shape:
//   {
//     map:   { [productCode: string]: 'MTO' | 'MTS' },
//     names: { [productCode: string]: string },
//     count, warnings,
//   }

const PRODUCT_RE = /^33\d{7}$/;
const POLICY_VALUES = new Set(['MTO', 'MTS']);
const HEADER_TOKENS = new Set(['Item number', 'Name', 'Planning policy']);

function normalise(text) {
  return text
    .replace(/﻿/g, '')
    .replace(/[ ​]/g, ' ')
    .replace(/\r\n?/g, '\n');
}

function rowsFromHTML(html) {
  if (!html || typeof DOMParser === 'undefined') return null;
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
  const rows = [];
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = Array.from(tr.querySelectorAll('th, td')).map((c) => (c.textContent ?? '').trim());
    if (cells.length >= 3) rows.push([cells[0], cells[1], cells[2]]);
  }
  return rows.length > 0 ? rows : null;
}

function rowsFromText(text) {
  return normalise(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => line.split('\t').map((c) => c.trim()))
    .filter((cells) => cells.length >= 3);
}

export function parsePolicy(textOrPayload) {
  const html = typeof textOrPayload === 'object' ? textOrPayload.html : null;
  const text = typeof textOrPayload === 'object' ? textOrPayload.text : textOrPayload;

  const rows = rowsFromHTML(html) ?? rowsFromText(text ?? '');

  const map = {};
  const names = {};
  const warnings = [];
  let count = 0;

  for (let i = 0; i < rows.length; i++) {
    const [productCode, name, policy] = rows[i];

    if (HEADER_TOKENS.has(productCode) || HEADER_TOKENS.has(policy)) continue;

    if (!PRODUCT_RE.test(productCode)) {
      warnings.push(`Row ${i + 1}: invalid product code "${productCode}"`);
      continue;
    }
    if (!POLICY_VALUES.has(policy)) {
      warnings.push(`Row ${i + 1} (${productCode}): unexpected policy "${policy}"`);
      continue;
    }
    if (map[productCode] && map[productCode] !== policy) {
      warnings.push(`Row ${i + 1}: duplicate ${productCode} with different policy (kept first: ${map[productCode]}, ignored: ${policy})`);
      continue;
    }
    if (map[productCode]) continue;

    map[productCode] = policy;
    names[productCode] = name ?? '';
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
