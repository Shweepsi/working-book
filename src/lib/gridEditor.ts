// The template editor's side of the shared workbooks: the key that lets this
// device change the Suivi template, and the Worker calls that need it.
//
// The Worker refuses template uploads and shift moves without the key
// (GRID_ADMIN_KEY, see worker/src/grid.ts). It is typed once in Settings and
// kept on the device; the editing controls only show where it is.

import { useSyncExternalStore } from 'react';
import { API_BASE } from './api';
import type { Partition } from './sharedGrid';

const KEY_STORAGE = 'wb.grid.editorKey';
const listeners = new Set<() => void>();

function readKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

let key = readKey();

function setKey(next: string | null): void {
  key = next;
  try {
    if (next) localStorage.setItem(KEY_STORAGE, next);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Kept for this session only.
  }
  listeners.forEach((l) => l());
}

/** Whether this device may edit the template. */
export function useTemplateEditor(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => key !== null,
  );
}

/** Checks the key with the Worker and keeps it if it is the right one. */
export async function unlockTemplateEditor(candidate: string): Promise<boolean> {
  const r = await fetch(`${API_BASE}/api/grid/admin`, { headers: { 'X-Grid-Key': candidate } });
  if (r.status === 204) {
    setKey(candidate);
    return true;
  }
  if (r.status === 403) return false;
  throw new Error(`Vérification impossible (${r.status})`);
}

export function lockTemplateEditor(): void {
  setKey(null);
}

function editorHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { ...extra, 'X-Grid-Key': key ?? '' };
}

function refused(status: number): Error {
  if (status === 403) {
    // The key changed on the Worker: this device is no editor any more.
    setKey(null);
    return new Error('Clé du modèle refusée : déverrouille à nouveau dans les paramètres.');
  }
  return new Error(`Refusé par le serveur (${status}).`);
}

/** A template's bytes (immutable per id). */
export async function fetchTemplate(id: number): Promise<ArrayBuffer> {
  const r = await fetch(`${API_BASE}/api/grid/template?id=${id}`);
  if (!r.ok) throw new Error(`Modèle introuvable (${r.status}).`);
  return r.arrayBuffer();
}

/** Stores a new template; shifts not started yet start from it. */
export async function uploadTemplate(bytes: Blob, name: string): Promise<number> {
  const r = await fetch(`${API_BASE}/api/grid/templates?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: editorHeaders(),
    body: bytes,
  });
  const body = (await r.json().catch(() => ({}))) as { id?: number; error?: string; max?: number };
  if (r.ok && body.id) return body.id;
  if (body.error === 'not_xlsx') throw new Error('Ce fichier n’est pas un classeur .xlsx.');
  if (body.error === 'template_too_large') throw new Error('Modèle trop lourd (1,9 Mo maximum).');
  if (body.error === 'too_many_templates') throw new Error(`Trop de modèles enregistrés (${body.max ?? 30} maximum).`);
  throw refused(r.status);
}

/** Moves a shift to another template; its cells stay at the same addresses. */
export async function moveToTemplate(p: Partition, templateId: number): Promise<void> {
  const r = await fetch(`${API_BASE}/api/grid/doc/template?date=${p.date}&poste=${p.poste}`, {
    method: 'PUT',
    headers: editorHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ template_id: templateId }),
  });
  if (!r.ok) throw refused(r.status);
}
