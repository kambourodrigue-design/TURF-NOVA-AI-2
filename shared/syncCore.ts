// Code partagé entre le serveur (functions/) et l'application (src/).
// Aucune dépendance au navigateur ni à Cloudflare : uniquement de la logique pure.

export const KINDS = ['products', 'sales', 'expenses', 'customers', 'suppliers', 'settings'] as const;
export type Kind = (typeof KINDS)[number];
export const isKind = (k: unknown): k is Kind => typeof k === 'string' && (KINDS as readonly string[]).includes(k);

export type ShopRole = 'owner' | 'manager' | 'cashier';

/** Identifiant unique de l'enregistrement « paramètres de la boutique ». */
export const SETTINGS_ID = 'main';

/** Limites des lots (voir limites D1 : 100 paramètres liés, 2 Mo par valeur). */
export const MAX_CHANGES = 100;
export const MAX_BATCH_CHARS = 900_000;
export const MAX_RECORD_CHARS = 200_000;

/**
 * Champs « compteurs » : deux appareils peuvent les modifier en même temps (ex. le stock quand
 * deux caissiers vendent). On ne remplace pas la valeur : on applique la DIFFÉRENCE (delta)
 * par rapport à la valeur que l'appareil avait vue la dernière fois. Le résultat ne dépend donc
 * pas de l'ordre d'arrivée.
 */
export const COUNTERS: Partial<Record<Kind, readonly string[]>> = {
  products: ['stockQuantity'],
  customers: ['totalDebt'],
  suppliers: ['totalDebt'],
};

/** Listes à ajouter seulement (jamais écrasées) : fusionnées par identifiant. */
export const UNIONS: Partial<Record<Kind, Record<string, string>>> = {
  customers: { payments: 'id' },
  suppliers: { payments: 'id' },
};

/** JSON à clés triées : deux objets identiques donnent toujours le même texte. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    const s = JSON.stringify(v);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : stableStringify(x))).join(',') + ']';
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}';
}

/** Empreinte rapide (cyrb53) — suffisante pour détecter qu'un enregistrement a changé. */
export function hashString(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const hashRecord = (rec: unknown) => hashString(stableStringify(rec));

/** Valeurs actuelles des compteurs d'un enregistrement (ou undefined s'il n'en a pas). */
export function counterValues(kind: Kind, rec: any): Record<string, number> | undefined {
  const names = COUNTERS[kind];
  if (!names || !rec) return undefined;
  const out: Record<string, number> = {};
  for (const n of names) {
    const v = Number(rec[n]);
    if (Number.isFinite(v)) out[n] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export const recordKey = (kind: Kind, id: string) => kind + ':' + id;

/** Identifiant unique, sans collision entre appareils (horodatage + aléa). */
export function newId(prefix: string): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rnd}`;
}
