// GridCraft's engine and MCP server, compiled to wasm (Shweepsi/gridcraft,
// apps/gridcraft-worker). Fetched into ./engine/ by scripts/fetch-engine.sh, at
// the release that script pins.
//
// The module is instantiated on first use, not when the Worker starts: most
// requests here (OAuth, discovery) never need it.

import wasmModule from './engine/gridcraft_worker_bg.wasm';
import { initSync, Shift, tools } from './engine/gridcraft_worker.js';

let ready = false;

function init(): void {
  if (!ready) {
    initSync({ module: wasmModule });
    ready = true;
  }
}

/** One cell as GridCraft's shared workbooks carry it (`gridcraft_engine::collab`). */
export interface CellChange {
  sheet: string;
  cell: string;
  c: unknown;
}

/** What one MCP message did to the shift's workbook. */
export interface Outcome {
  /** The JSON-RPC reply, as JSON. */
  response: string | null;
  /** The cells it changed, for the other devices. */
  changes: CellChange[];
  /** It changed what cell changes don't carry (sheets, sizes, merges, …). */
  structural: boolean;
  /** The shared workbook was closed. */
  lost: boolean;
}

/** One shift's workbook in this isolate's engine. */
export class Workbook {
  private shift: Shift;

  constructor(name: string, template: Uint8Array, cells: CellChange[]) {
    init();
    this.shift = new Shift(name, template, JSON.stringify(cells));
  }

  /** Another device's cells, not reported back. */
  apply(cells: CellChange[]): void {
    if (cells.length) this.shift.apply(JSON.stringify(cells));
  }

  /** One JSON-RPC message; commit() or rollback() must follow. */
  handle(message: unknown): Outcome {
    return JSON.parse(this.shift.handle(JSON.stringify(message))) as Outcome;
  }

  commit(): void {
    this.shift.commit();
  }

  rollback(): void {
    this.shift.rollback();
  }

  /** The workbook's defined names. */
  names(): { name: string; scope: number | null; formula: string }[] {
    return JSON.parse(this.shift.names()) as { name: string; scope: number | null; formula: string }[];
  }

  free(): void {
    this.shift.free();
  }
}

/** GridCraft's MCP tools, as `tools/list` gives them. */
export function engineTools(): { name: string; description?: string; inputSchema?: unknown }[] {
  init();
  return JSON.parse(tools()) as { name: string; description?: string; inputSchema?: unknown }[];
}

/** A wasm trap: the instance may be left inconsistent, so it must not be used again. */
export function isTrap(e: unknown): boolean {
  return e instanceof WebAssembly.RuntimeError;
}
