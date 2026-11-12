// npm test — the PMS230 decoder against real report rows.
//
// The fixture is a real paste of sched 2213000918 (November 2026), one cell
// per line as the extension reads it. PMS230 had just added an MTO/MTS cell in
// front of the MO, which pushed the MO to the 12th cell on every row with a
// Date Départ: those rows were dropped on every import and kept their stale
// « reste » in the Schedule (MO 1000227095: 40/40 produced, shown 0/40).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropVanished, mergePMS230, parsePMS230, searchOf } from '../src/lib/pms230Parser.ts';

const HEADER = [
  'release/176050/2.2 2025-11-14 15:00', 'Facility', '221', 'Work Center',
  'From Start Date', '20261104', 'To Start Date', '20261125', 'Search',
  'PMS230Export PDF', 'Post Production Report', '2213000918',
];

const ROWS = [
  '2213000918|0|90|90|10|Coating - Bascharage|20261106|23:37|20261106|23:59|MTS|1000226525|330130395|Vacuum Coated QC Sample Item|60|1|59|0.00|0|0.00|0.00',
  '2213000918|0|90|90|10|Coater|20261106|23:43|20261106|23:59|MTS|1000226524|330181250|CSGSNX70HXC0600TPF|9|9|0|0.24|24|3210.00|6000.00|XC|9|O PL6|I11L|126 3/8|236 7/32|06.00|5.80|6.20',
  '2213000918|0|90|90|10|Coater|20261107|22:48|20261107|23:59|20261123|MTO|1000227095|330183172|CSGSNX70HXC1000TPF|40|40|0|1.04|10|3210.00|6000.00|XC|5|O PL6|I11L|126 3/8|236 7/32|10.00|9.70|10.30|Alu Glass Shpk',
  '2213000918|0|90|90|10|Coater|20261107|23:35|20261107|23:59|MTO|1000226536|330186452|CSGSNX70HXC0600TPF|32|32|0|0.36|3|3210.00|2550.00|XC|16|O PL6|I11L|126 3/8|100 25/64|06.00|5.80|6.20',
  '2213000918|0|90|90|10|Coater|20261108|23:42|20261108|23:59|MTO|1000227096|330182928|CSGSNX70HXC1000TPF|10|10|0|0.26|0|3210.00|6000.00|XC|5|O PL6|I11L|126 3/8|236 7/32|10.00|9.70|10.30',
  '2213000918|0|90|90|10|Coater|20261108|21:46|20261108|23:59|20261117|MTO|1000227097|330195991|CSGSNX70HUC0600TPF|76|0|76|0.00|0|3210.00|6000.00|UC|19|O PL6|I11L|126 3/8|236 7/32|06.00|5.80|6.20|Flachglas Wernberg GmbH',
  '2213000918|0|90|90|10|Coater|20261108|22:23|20261108|23:59|20261124|MTO|1000228283|330196100|CSGSNX70HUC0800TPF|64|0|64|0.00|0|3210.00|5100.00|UC|8|O PL6|I11L|126 3/8|200 25/32|08.00|7.70|8.30|Al Abbar Tempering Plant',
  '2213000918|0|90|90|10|Coater|20261108|23:49|20261108|23:59|MTO|1000228688|330197379|CSGSNX70HXC0600TPF|6|6|0|0.15|0|3210.00|6000.00|XC|2|O PL6|I11L|126 3/8|236 7/32|06.00|5.80|6.20',
];

const paste = (rows: string[]) => [...HEADER, ...rows.flatMap((r) => r.split('|'))].join('\n');
const mos = (text: string) => parsePMS230(text).records.map((r) => r.mo);
const moWarnings = (text: string) => parsePMS230(text).warnings.filter((w) => /MO|product/.test(w));

test('every row of the report is read, MTO/MTS cell or not', () => {
  const { records } = parsePMS230(paste(ROWS));
  assert.deepEqual(records.map((r) => r.mo), [
    '1000226525', '1000226524', '1000227095', '1000226536',
    '1000227096', '1000227097', '1000228283', '1000228688',
  ]);
  assert.deepEqual(moWarnings(paste(ROWS)), []);
});

test('a produced row with a Date Départ carries its production', () => {
  const r = parsePMS230(paste(ROWS)).records.find((x) => x.mo === '1000227095')!;
  assert.equal(r.dateDepart, '20261123');
  assert.equal(r.startDate, '20261107');
  assert.equal(r.startTime, '22:48');
  assert.equal(r.endTime, '23:59');
  assert.equal(r.workCenter, 'Coater');
  assert.equal(r.opSteps, '90/90/10');
  assert.equal(r.opStepD, 90);
  assert.deepEqual([r.schedLites, r.prodLites, r.reqLites], [40, 40, 0]);
  assert.equal(r.itemName, 'CSGSNX70HXC1000TPF');
  assert.equal(r.longueur, 6000);
});

test('the report as it was before the MTO/MTS cell still reads', () => {
  const old = ROWS.map((r) => r.replace(/\|(MTO|MTS)\|/, '|'));
  assert.equal(mos(paste(old)).length, ROWS.length);
});

test('an empty Work Center does not take the MTO/MTS label', () => {
  const row = ROWS[2]!.replace('|Coater|', '|');
  const r = parsePMS230(paste([row])).records[0]!;
  assert.equal(r.mo, '1000227095');
  assert.equal(r.workCenter, '');
  assert.equal(r.dateDepart, '20261123');
});

test('an unexpected product code is reported as such, not as a missing MO', () => {
  const row = ROWS[2]!.replace('|330183172|', '|340183172|');
  const warnings = moWarnings(paste([row]));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /expected product code/);
});

test('every lost row counts as dropped, and nothing else does', () => {
  // The header holds the schedule echoed by the search criteria: one lone
  // cell, warned about (« only 1 fields ») but not a row.
  assert.equal(parsePMS230(paste(ROWS)).dropped, 0);
  assert.ok(parsePMS230(paste(ROWS)).warnings.some((w) => /only 1 fields/.test(w)));

  const badProduct = ROWS[2]!.replace('|330183172|', '|340183172|');
  const noMo = ROWS[2]!.replace('|1000227095|', '|');
  const truncated = ROWS[2]!.split('|').slice(0, 8).join('|');
  // A row with its lites gone is decoded and kept, short of a field.
  const partial = ROWS[2]!.replace('|40|40|0|1.04|', '|x|');
  const r = parsePMS230(paste([badProduct, noMo, truncated, partial, ROWS[3]!]));
  assert.equal(r.dropped, 3);
  assert.deepEqual(r.records.map((x) => x.mo), ['1000227095', '1000226536']);
});

test('a merge keeps the last import\'s warnings, not every import\'s', () => {
  const bad = parsePMS230(paste([ROWS[2]!.replace('|330183172|', '|340183172|')]));
  const good = parsePMS230(paste(ROWS));
  const once = mergePMS230(null, bad).result;
  assert.ok(once.warnings.length > 0);
  const twice = mergePMS230(once, bad).result;
  assert.equal(twice.warnings.length, once.warnings.length);
  assert.deepEqual(mergePMS230(twice, good).result.warnings, good.warnings);
  assert.equal(mergePMS230(twice, good).result.dropped, 0);
});

// Sched 2213000932 (November 2026): M3 split MO 1000229251 (232 lites) into
// 1000230291 (116) and 1000229254 (408) into 1000230292 (204). The two old
// MOs left PMS230 but stayed in the Schedule at 0 produced, since an import
// only ever adds.
const S932 = '2213000932|0|40|20|10|Coater|20261110|21:54|20261111|00:55|MTS|1000229251|330181159|CCGP2XC0400|232|0|232|0.00|0|3210.00|6000.00|XC|29|O PL4|I11L|126 3/8|236 7/32|04.00|3.80|4.20';
const S932_NOW = [
  '2213000932|0|90|80|10|Coater|20261111|23:25|20261112|00:55|MTS|1000230291|330181159|CCGP2XC0400|116|116|0|1.40|0|3210.00|6000.00|XC|29|O PL4|I11L|126 3/8|236 7/32|04.00|3.80|4.20',
  '2213000932|0|70|60|10|Coater|20261111|17:06|20261111|23:59|20261116|MTO|1000229248|330203280|CCGP2XC0400|536|402|134|4.80|52|3210.00|6000.00|XC|134|O PL4|I11L|126 3/8|236 7/32|04.00|3.80|4.20|AGC INTERPANE SAS',
];
const keysOf = (text: string) => parsePMS230(text).records.map((r) => `${r.schedule}|${r.mo}`);

test('the search a page answers is read from its header', () => {
  assert.deepEqual(searchOf(paste(ROWS)), { from: '20261104', to: '20261125' });
  assert.equal(searchOf(ROWS.join('\n')), null);
});

test('a line M3 no longer reports leaves the Schedule after a whole walk', () => {
  const before = mergePMS230(parsePMS230(paste(ROWS)), parsePMS230(paste([S932, ...S932_NOW]))).result;
  const now = paste(S932_NOW);
  const { result, removed } = dropVanished(before, keysOf(now), searchOf(now)!);
  assert.deepEqual(removed.map((r) => r.mo), ['1000229251']);
  assert.ok(!result.records.some((r) => r.mo === '1000229251'));
  // Schedules the walk did not see are untouched.
  assert.equal(result.records.filter((r) => r.schedule === '2213000918').length, ROWS.length);
  assert.equal(result.schedules.find((s) => s.schedule === '2213000932')?.recordCount, 2);
});

test('a line the search did not ask for is kept', () => {
  const before = parsePMS230(paste([S932, ...S932_NOW]));
  const seen = keysOf(paste(S932_NOW));
  const window = { from: '20261104', to: '20261125' };
  // Before the search's first day.
  assert.equal(dropVanished(before, seen, { from: '20261111', to: '20261125' }).removed.length, 0);
  // Another work center than any the walk saw in that schedule: a search
  // narrowed to COATER does not see the QC samples of Coating - Bascharage.
  const qc = parsePMS230(paste([ROWS[0]!.replaceAll('2213000918', '2213000932'), ...S932_NOW]));
  assert.equal(dropVanished(qc, seen, window).removed.length, 0);
  // Nothing seen, nothing known.
  assert.equal(dropVanished(before, [], window).removed.length, 0);
});
