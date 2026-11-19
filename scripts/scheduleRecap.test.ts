// npm test — the récap plaques grouping.
//
// sched 2213000966 (November 2026): a CSGSNX70UC12006.6.2CL that PMS230 printed
// as XC. On the récap it leaves both qualités for an « à vérifier » group,
// printed last, and the sheet's total still matches the detailed one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PMS230Record } from '../src/lib/pms230Parser.ts';
import { buildScheduleRecap } from '../src/lib/scheduleRecap.ts';

const row = (itemName: string, qualite: string, reqLites: number, pdp = 'O PL6'): PMS230Record => ({
  id: `${itemName}-${qualite}-${reqLites}`, schedule: '2213000966', schedSuffix: '0', opSteps: '70/60/10',
  opStepD: 60, workCenter: 'Coater', startDate: '20261120', startTime: '22:53', endDate: '20261120',
  endTime: '23:59', dateDepart: null, mo: '1000230753', product: '330206861', itemName,
  schedLites: reqLites, prodLites: 0, reqLites, opTm: 0, scrap: 0, largeur: 3210, longueur: 6000,
  qualite, litesPerPack: 5, pdp, formatCode: 'I11L', largeurInch: '', longueurInch: '',
  thickness: '12.00', customer: '', m2: 0,
});

const ROWS = [
  row('CSGSNX70UC12006.6.2CL', 'XC', 25),
  row('CSGSNX70XC12006.6.2CL', 'XC', 10),
  row('CSGSNX70UC12006.6.2SR', 'UC', 24, 'O PL44.2'),
];

test('contested rows leave their qualité for a last « à vérifier » group', () => {
  const recap = buildScheduleRecap(ROWS);
  assert.deepEqual(
    recap.qualities.map((q) => [q.contested ? 'À vérifier' : q.qualite, q.reqLites]),
    [['UC', 24], ['XC', 10], ['À vérifier', 25]],
  );
  const plate = recap.qualities.at(-1)!.dimensions[0]!.plates[0]!;
  assert.deepEqual(plate.contested, { report: 'XC', code: 'UC' });
  assert.equal(plate.makeup, '6.6.2');
  // Nothing outside the contested group carries the flag.
  for (const q of recap.qualities.slice(0, -1)) {
    for (const d of q.dimensions) for (const p of d.plates) assert.equal(p.contested, null);
  }
});

test('the récap total still matches the rows', () => {
  const recap = buildScheduleRecap(ROWS);
  assert.equal(recap.reqLites, 59);
  assert.equal(recap.lines, 3);
});

test('no contested group when every row agrees', () => {
  const recap = buildScheduleRecap(ROWS.slice(1));
  assert.ok(recap.qualities.every((q) => !q.contested));
});
