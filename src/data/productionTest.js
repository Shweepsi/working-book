// Production-test schema: instruments, the codes/plates each measures, and
// per-section tolerances so cells can flag out-of-spec live.

export const TD_PAIRS = [
  ['T4', 'T20'], ['T6', 'T21'], ['T8', 'T23'], ['T10', 'T24'],
  ['T12', 'T28'], ['T15', 'T29'], ['T16', 'T31'], ['T17', 'T32'], ['T18', 'T35'],
];

export const OPTOPLEX_CODES = ['C7', 'C11', 'C22', 'C27', 'C30', 'C35'];
export const ZEISS_CODES = ['CF', 'CV', 'TR', '55'];

export const TOLERANCE = {
  td: { min: 70, max: 95 },
  optoplex: {
    Y: { min: 78, max: 92 },
    'a*': { min: -3, max: 3 },
    'b*': { min: -5, max: 5 },
  },
  zeiss: {
    Y: { min: 78, max: 92 },
    'a*': { min: -3, max: 3 },
    'b*': { min: -5, max: 5 },
  },
  stack: {
    Tsol: { min: 35, max: 55 },
    Rsol: { min: 20, max: 40 },
    Asol: { min: 10, max: 30 },
  },
};

export function checkTolerance(range, raw) {
  if (raw === '' || raw == null) return 'empty';
  const n = Number(raw);
  if (Number.isNaN(n)) return 'invalid';
  if (n < range.min || n > range.max) return 'bad';
  return 'ok';
}

export const HEADER_DEFAULTS = {
  product: 'SG NRG A/R Clear',
  speed: '6 m/mn',
};
