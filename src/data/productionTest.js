// Production-test schema: instruments and the codes/plates each measures.

export const TD_PAIRS = [
  ['T4', 'T20'], ['T6', 'T21'], ['T8', 'T23'], ['T10', 'T24'],
  ['T12', 'T28'], ['T15', 'T29'], ['T16', 'T31'], ['T17', 'T32'], ['T18', 'T35'],
];

// Enter-key navigation order: walk down the left column first, then the right.
// Pressing Enter on T4 → T6 → … → T18 → T20 → T21 → … → T35.
export const TD_ENTER_ORDER = [
  ...TD_PAIRS.map(([a]) => a),
  ...TD_PAIRS.map(([, b]) => b),
];

export const OPTOPLEX_CODES = ['C7', 'C11', 'C22', 'C27', 'C30', 'C35'];
export const ZEISS_CODES = ['CF', 'CV', 'TR', '55'];

export const HEADER_DEFAULTS = {
  product: 'SG NRG A/R Clear',
  speed: '6 m/mn',
};
