// npm test — the PMS230 decoder against real report rows.
//
// The fixture is a real paste of sched 2213000918 (November 2026), one cell
// per line as the extension reads it. PMS230 had just added an MTO/MTS cell in
// front of the MO, which pushed the MO to the 12th cell on every row with a
// Date Départ: those rows were dropped on every import and kept their stale
// « reste » in the Schedule (MO 1000227095: 40/40 produced, shown 0/40).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { droppedRows, mergePMS230, parsePMS230 } from '../src/lib/pms230Parser.ts';

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

test('only lost rows count as dropped: stray cells and kept rows do not', () => {
  const lost = ROWS[2]!.replace('|330183172|', '|340183172|');
  // The report's title line is a lone cell before the first schedule.
  const noisy = ['SOMETHING', ...HEADER, ...lost.split('|')].join('\n');
  const { warnings } = parsePMS230(noisy);
  assert.ok(warnings.length >= 1);
  assert.equal(droppedRows(warnings), 1);
  assert.equal(droppedRows(parsePMS230(paste(ROWS)).warnings), 0);
});

test('a merge keeps the last import\'s warnings, not every import\'s', () => {
  const bad = parsePMS230(paste([ROWS[2]!.replace('|330183172|', '|340183172|')]));
  const good = parsePMS230(paste(ROWS));
  const once = mergePMS230(null, bad).result;
  assert.ok(once.warnings.length > 0);
  const twice = mergePMS230(once, bad).result;
  assert.equal(twice.warnings.length, once.warnings.length);
  assert.deepEqual(mergePMS230(twice, good).result.warnings, good.warnings);
});
