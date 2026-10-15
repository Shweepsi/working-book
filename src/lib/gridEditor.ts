// Changing the Suivi template: Worker calls behind « Modifier le modèle ».
//
// Only preview builds (the dev channel) offer it, like the Suivi tab itself:
// production has neither, and only the dev Worker serves /api/grid/.

import { API_BASE } from './api';
import { IS_DEV_CHANNEL } from './channel';
import type { Partition } from './sharedGrid';

/** Whether this build lets the template be edited. */
export const CAN_EDIT_TEMPLATE = IS_DEV_CHANNEL;

/** A template's bytes (immutable per id). */
export async function fetchTemplate(id: number): Promise<ArrayBuffer> {
  const r = await fetch(`${API_BASE}/api/grid/template?id=${id}`);
  if (!r.ok) throw new Error(`Modèle introuvable (${r.status}).`);
  return r.arrayBuffer();
}

/** Stores a new template; shifts not started yet start from it. */
export async function uploadTemplate(bytes: Blob, name: string): Promise<number> {
  const r = await fetch(`${API_BASE}/api/grid/templates?name=${encodeURIComponent(name)}`, { method: 'POST', body: bytes });
  const body = (await r.json().catch(() => ({}))) as { id?: number; error?: string; max?: number };
  if (r.ok && body.id) return body.id;
  if (body.error === 'not_xlsx') throw new Error('Ce fichier n’est pas un classeur .xlsx.');
  if (body.error === 'template_too_large') throw new Error('Modèle trop lourd (1,9 Mo maximum).');
  if (body.error === 'too_many_templates') throw new Error(`Trop de modèles enregistrés (${body.max ?? 30} maximum).`);
  throw new Error(`Refusé par le serveur (${r.status}).`);
}

/** Moves a shift to another template; its cells stay at the same addresses. */
export async function moveToTemplate(p: Partition, templateId: number): Promise<void> {
  const r = await fetch(`${API_BASE}/api/grid/doc/template?date=${p.date}&poste=${p.poste}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template_id: templateId }),
  });
  if (!r.ok) throw new Error(`Bascule refusée par le serveur (${r.status}).`);
}
