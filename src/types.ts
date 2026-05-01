// Domain types shared across the app.

export type Poste = 'A' | 'B' | 'C' | 'D';

export type ShiftKey = 'M' | 'A' | 'N' | 'R';

export interface ShiftType {
  key: ShiftKey;
  label: string;
  hours: string;
  range: [number, number] | null;
}

export type FlagKey = 'normal' | 'ok' | 'scheduled' | 'unscheduled' | 'note';

export type FlagTint = 'green' | 'yellow' | 'red' | 'blue' | null;

export interface Flag {
  key: FlagKey;
  label: string;
  tint: FlagTint;
}

export interface EventType {
  key: string;
  label: string;
  defaultFlag: FlagKey;
  bold: boolean;
}

export interface ShiftEvent {
  id: string;
  start: string | null;
  end: string | null;
  type: string;
  desc: string;
  notes?: string[];
  flag: FlagKey | '' | null;
}

export interface ShiftMeta {
  poste: Poste | null;
  date: string;
  dateLabel: string;
  shift: ShiftType;
}

export type Theme = 'auto' | 'light' | 'dark';

export type Density = 'compact' | 'normal' | 'advanced';

// PMS230 ----------------------------------------------------------------------

export interface PMS230Record {
  id: string;
  schedule: string;
  schedSuffix: string;
  opSteps: string;
  opStepD: number;
  workCenter: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  dateDepart: string | null;
  mo: string;
  product: string;
  itemName: string;
  schedLites: number;
  prodLites: number;
  reqLites: number;
  scraps: number;
  largeur: number;
  longueur: number;
  qualite: string;
  litesPerPack: number | null;
  pdp: string;
  formatCode: string;
  largeurInch: string;
  longueurInch: string;
  thickness: string;
  customer: string;
  m2: number;
}

export interface ScheduleSummary {
  schedule: string;
  itemRoot: string;
  totalM2: number;
  totalLites: number;
  recordCount: number;
}

export interface PMS230ParseResult {
  records: PMS230Record[];
  schedules: ScheduleSummary[];
  warnings: string[];
  currentPage: number | null;
  totalPages: number | null;
  importedAt: string;
}

export interface PastePayload {
  html?: string | null;
  text?: string | null;
}

// Policy import (Item number → MTO/MTS) --------------------------------------

export type PolicyValue = 'MTO' | 'MTS';

export interface PolicyResult {
  map: Record<string, PolicyValue>;
  names: Record<string, string>;
  count: number;
  warnings: string[];
  importedAt: string;
}

// Production test ------------------------------------------------------------

export interface PtHeader {
  testNo: string;
  operator: string;
  date: string;
  hour: string;
  product: string;
  speed: string;
  m3Lot: string;
  thickness: string;
  origin: string;
  resistance: string;
}

export interface YabValues {
  Y?: string;
  'a*'?: string;
  'b*'?: string;
}

export interface StackValues {
  Tsol: string;
  Rsol: string;
  Asol: string;
}

export type StackAxis = keyof StackValues;
export type YabAxis = keyof YabValues;
export type YabGroup = 'optoplex' | 'zeiss';

export interface ProductionTest {
  id: string;
  header: PtHeader;
  td: Record<string, string>;
  optoplex: Record<string, YabValues>;
  zeiss: Record<string, YabValues>;
  stack: StackValues;
  comments: string;
}

export interface ProductionTestState {
  tests: ProductionTest[];
  activeId: string;
}

// Coater rows (a subset of PMS230Record used by the math helpers) ------------

export type CoaterRow = Pick<
  PMS230Record,
  'largeur' | 'longueur' | 'schedLites' | 'reqLites' | 'm2'
>;
