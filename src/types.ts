// Cross-cutting domain types. Leaf-shaped types (parser results, ProductionTest's
// Test/TestState) live next to their owning module.

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
  // `true` prefills the description with the label; a string prefills with
  // that exact text (e.g. Qualité → "Test"); `false` leaves it empty.
  prefill: boolean | string;
  row: 1 | 2;
  openNote?: boolean;
}

export interface LogEvent {
  id: string;
  start: string | null;
  end: string | null;
  type: string;
  desc: string;
  flag: FlagKey | null;
  notes?: string[];
  bold?: boolean;
  danger?: boolean;
  // Audit timestamps (epoch ms). Optional so legacy entries from older versions
  // load without migration. Set on first save and bumped on every edit.
  createdAt?: number;
  updatedAt?: number;
}

export interface ShiftMeta {
  poste: Poste | null;
  date: string;
  dateLabel: string;
  shift: ShiftType;
}

export type Theme = 'auto' | 'light' | 'dark';

export type Density = 'compact' | 'normal' | 'advanced';
