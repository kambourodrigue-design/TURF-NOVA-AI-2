// Photos des produits : compression sur le téléphone, envoi au serveur, petit magasin partagé (id produit → version).
import { useSyncExternalStore } from 'react';
import { api } from './api';

interface PhotoState { map: Record<string, number>; loaded: boolean; max: number; unavailable: boolean }
let state: PhotoState = { map: {}, loaded: false, max: 200, unavailable: false };
const subs = new Set<() => void>();
const emit = () => { state = { ...state, map: { ...state.map } }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const photoUrl = (pid: string, v: number) => `/api/images/${encodeURIComponent(pid)}?v=${v}`;
export const usePhotos = () => useSyncExternalStore(subscribe, () => state);

export async function loadPhotos(force = false) {
  if (state.loaded && !force) return;
  try {
    const r = await api.images();
    state = { map: r.images || {}, loaded: true, max: r.max || 200, unavailable: !!r.unavailable };
    subs.forEach((f) => f());
  } catch { /* hors-ligne : on réessaiera à la prochaine ouverture */ }
}
export async function savePhoto(pid: string, blob: Blob) { const r = await api.imagePut(pid, blob); state.map[pid] = r.v; emit(); }
export async function removePhoto(pid: string) { await api.imageDelete(pid); delete state.map[pid]; emit(); }

/** Réduit la photo (720 px max, WebP ou JPEG, moins de ~110 Ko) : rapide à envoyer même avec une connexion lente. */
export async function compressImage(file: File, maxSide = 720): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error("Ce fichier n'est pas une image.");
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions); }
  catch { try { bmp = await createImageBitmap(file); } catch { throw new Error("Impossible de lire cette photo. Essayez une photo JPEG ou PNG."); } }
  const r = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * r)), h = Math.max(1, Math.round(bmp.height * r));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Photo non prise en charge sur cet appareil.');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const toBlob = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  let q = 0.8, type = 'image/webp';
  let blob = await toBlob(type, q);
  if (!blob || blob.type !== 'image/webp') { type = 'image/jpeg'; blob = await toBlob(type, q); }   // anciens iPhone : pas de WebP
  while (blob && blob.size > 110_000 && q > 0.35) { q -= 0.1; blob = await toBlob(type, q); }
  if (!blob || blob.size > 130_000) throw new Error('Photo trop lourde, essayez-en une autre.');
  return blob;
}
