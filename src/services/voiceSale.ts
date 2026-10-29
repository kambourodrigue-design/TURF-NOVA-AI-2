// Saisie de vente à la voix / au texte libre : analyse d'une phrase et rapprochement avec les produits.
import { Product, Customer } from '../types';
import { api } from './api';

export interface VoiceLine { product: Product | null; label: string; qty: number }
export interface VoiceResult {
  lines: VoiceLine[];
  payment: 'cash' | 'credit' | 'mobile' | null;
  customerId: string | null;
  viaAi: boolean;
}

export const norm = (s: string) => String(s ?? '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const NUM: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, quinze: 15, vingt: 20, trente: 30, cinquante: 50, cent: 100,
};

/** Trouve le produit le plus proche d'un libellé (ou null). */
export function matchProduct(label: string, products: Product[]): Product | null {
  const q = norm(label);
  if (!q) return null;
  const qt = q.split(' ').filter(w => w.length > 1);
  let best: Product | null = null, bestScore = 0;
  for (const p of products) {
    const n = norm(p.name);
    let score = 0;
    if (n === q) score = 100;
    else if (n.includes(q) || q.includes(n)) score = 60 + Math.min(n.length, q.length);
    else {
      const nt = n.split(' ');
      const hit = qt.filter(w => nt.some(t => t === w || (w.length > 3 && (t.startsWith(w) || w.startsWith(t))))).length;
      score = qt.length ? (hit / Math.max(qt.length, nt.length)) * 50 : 0;
    }
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return bestScore >= 20 ? best : null;
}

/** Analyse locale (sans IA) : « 2 sucre et 3 huile à crédit ». */
export function parseLocally(text: string): { items: { name: string; qty: number }[]; payment: VoiceResult['payment']; customer: string | null } {
  let t = norm(text);
  let payment: VoiceResult['payment'] = null;
  if (/\b(a credit|credit|plus tard|carnet)\b/.test(t)) payment = 'credit';
  else if (/\b(wave|orange|momo|mobile|moov|mtn)\b/.test(t)) payment = 'mobile';
  t = t.replace(/\b(a credit|credit|plus tard|sur le carnet|carnet|en wave|wave|orange money|momo|mobile money)\b/g, ' ');
  const parts = t.split(/\b(?:et|puis|plus|avec)\b|,/).map(x => x.trim()).filter(Boolean);
  const items: { name: string; qty: number }[] = [];
  for (const part of parts) {
    const words = part.split(' ');
    let qty = 1, i = 0;
    if (/^\d+$/.test(words[0])) { qty = parseInt(words[0], 10); i = 1; }
    else if (NUM[words[0]] !== undefined) { qty = NUM[words[0]]; i = 1; }
    const name = words.slice(i).filter(w => !['de', 'du', 'des', 'd', 'la', 'le', 'les', 'sac', 'sacs', 'paquet', 'paquets', 'bouteille', 'bouteilles'].includes(w)).join(' ');
    if (name) items.push({ name, qty });
  }
  return { items, payment, customer: null };
}

export async function analyseSale(text: string, products: Product[], customers: Customer[]): Promise<VoiceResult> {
  let raw: { items: { name: string; qty: number }[]; payment: VoiceResult['payment']; customer: string | null };
  let viaAi = true;
  try {
    const r = await api.ai({ mode: 'sale', utterance: text, products: products.map(p => p.name) });
    raw = (r as any).parsed;
    if (!raw || !Array.isArray(raw.items)) throw new Error('bad');
  } catch {
    viaAi = false;
    raw = parseLocally(text);
  }
  const lines: VoiceLine[] = raw.items.map(i => ({ product: matchProduct(i.name, products), label: i.name, qty: Math.max(1, Math.round(i.qty) || 1) }));
  let customerId: string | null = null;
  if (raw.customer) {
    const c = norm(raw.customer);
    const hit = customers.find(x => norm(x.name).split(' ').includes(c) || norm(x.name) === c);
    customerId = hit?.id ?? null;
  }
  return { lines, payment: raw.payment, customerId, viaAi };
}
