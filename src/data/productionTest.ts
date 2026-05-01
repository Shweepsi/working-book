// Production-test schema: instruments and the codes/plates each measures.

export const TD_PAIRS = [
  ['T4', 'T20'], ['T6', 'T21'], ['T8', 'T23'], ['T10', 'T24'],
  ['T12', 'T28'], ['T15', 'T29'], ['T16', 'T31'], ['T17', 'T32'], ['T18', 'T35'],
] as const;

// Enter-key navigation: column-major. Walk down the first column, then
// the next column, etc. — same convention across TD / Optoplex / Zeiss.
export const TD_ENTER_ORDER: string[] = [
  ...TD_PAIRS.map(([a]) => a),
  ...TD_PAIRS.map(([, b]) => b),
];

export const OPTOPLEX_CODES = ['C7', 'C11', 'C22', 'C27', 'C30', 'C35'] as const;
export const ZEISS_CODES = ['CF', 'CV', 'TR', '55'] as const;

export const YAB_AXES = ['Y', 'a*', 'b*'] as const;
export const STACK_AXES = ['Tsol', 'Rsol', 'Asol'] as const;

export type YabAxis = (typeof YAB_AXES)[number];
export type StackAxis = (typeof STACK_AXES)[number];

// Build the column-major Enter order for a Y/a*/b* grid: all Y values
// first (top to bottom), then all a*, then all b*. Keys look like "C7.Y".
export function yabEnterOrder(codes: readonly string[]): string[] {
  return YAB_AXES.flatMap((axis) => codes.map((code) => `${code}.${axis}`));
}

export const HEADER_DEFAULTS = {
  product: 'SG NRG A/R Clear',
  speed: '6 m/mn',
};
