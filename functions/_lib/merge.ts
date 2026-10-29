// Fusion des modifications de plusieurs appareils / utilisateurs d'une même boutique.
// Logique PURE (aucun accès base de données) : facile à tester.
//
// Règles :
//  1. Chaque enregistrement (vente, produit, client…) est indépendant : deux personnes qui
//     ajoutent des ventes en même temps ne se gênent jamais.
//  2. Même enregistrement modifié des deux côtés : le plus récent l'emporte (champs normaux).
//  3. Compteurs (stock, dettes) : on applique la DIFFÉRENCE, pas la valeur → rien ne se perd.
//  4. Historiques de paiements : fusionnés (union), jamais écrasés.
//  5. Suppressions : conservées sous forme de « pierre tombale » pour que les autres appareils
//     les voient ; une modification plus récente que la suppression l'emporte.

import {
  COUNTERS, UNIONS, MAX_RECORD_CHARS, SETTINGS_ID, stableStringify,
  type Kind, type ShopRole,
} from '../../shared/syncCore';

export interface StoredRecord { json: string; t: number; deleted: boolean }

export interface Change {
  k: Kind;
  id: string;
  t: number;                       // heure de la modification (ms)
  d?: any;                         // enregistrement complet (absent pour une suppression)
  del?: boolean;
  c?: Record<string, number>;     // valeurs des compteurs vues la dernière fois (base du delta)
}

export type Status = 'ok' | 'adopt' | 'denied';

export interface MergeOutcome {
  status: Status;
  write: boolean;                  // faut-il enregistrer ?
  deleted: boolean;                // état final de l'enregistrement
  json: string | null;             // JSON final (vivant) ou conservé (supprimé)
  t: number;
  /** Ce que l'appareil doit adopter quand status ≠ 'ok'. */
  reply?: { d?: any; del?: true };
}

const clampT = (t: unknown, now: number) => {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return now;
  return Math.min(Math.floor(n), now + 120_000); // jamais dans le futur (horloge fausse)
};

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function serverVersion(S: { obj: any; deleted: boolean } | null): { d?: any; del?: true } {
  return S && !S.deleted ? { d: S.obj } : { del: true };
}

export function mergeChange(change: Change, stored: StoredRecord | null, role: ShopRole, now: number): MergeOutcome {
  const kind = change.k;
  const t = clampT(change.t, now);
  let obj: any = null;
  if (stored && !stored.deleted) {
    try { obj = JSON.parse(stored.json); } catch { obj = null; }
  }
  const S = stored ? { json: stored.json, t: stored.t, deleted: stored.deleted || obj === null, obj } : null;

  const deny = (): MergeOutcome => ({
    status: 'denied', write: false, deleted: !S || S.deleted, json: S ? S.json : null, t: S ? S.t : t,
    reply: serverVersion(S),
  });
  const keep = (status: Status): MergeOutcome => ({
    status, write: false, deleted: !S || S.deleted, json: S ? S.json : null, t: S ? S.t : t,
    reply: status === 'ok' ? undefined : serverVersion(S),
  });

  // ---- Droits selon le rôle (le caissier ne modifie ni prix, ni dépenses, ni paramètres) ----
  let fieldsEditable = true;
  if (role === 'cashier') {
    if (kind === 'sales') {
      if (change.del) return deny();
      if (S && !S.deleted) {
        // une vente déjà enregistrée ne se modifie pas ; renvoi identique = déjà fait
        return stableStringify(S.obj) === stableStringify(change.d) ? keep('ok') : deny();
      }
    } else if (kind === 'products') {
      if (change.del || !S || S.deleted) return deny();
      fieldsEditable = false;       // seul le stock (compteur) peut bouger
    } else if (kind === 'customers') {
      // clients et crédits : autorisé
    } else {
      return deny();
    }
  }

  // ---- Suppression ----
  if (change.del) {
    if (!S || S.deleted) return { status: 'ok', write: false, deleted: true, json: S ? S.json : null, t: S ? S.t : t };
    if (S.t > t) return keep('adopt'); // modifié APRÈS la suppression : la modification gagne
    return { status: 'ok', write: true, deleted: true, json: S.json, t };
  }

  // ---- Validation de l'enregistrement ----
  const R = change.d;
  if (!R || typeof R !== 'object' || Array.isArray(R) || String(R.id ?? '') !== change.id) {
    // un paramètre (settings) n'a pas d'id propre : on le force
    if (!(kind === 'settings' && R && typeof R === 'object' && !Array.isArray(R))) return deny();
  }
  const R2 = clone(R);
  const rText = JSON.stringify(R2);
  if (rText.length > MAX_RECORD_CHARS) return deny();

  // ---- Nouvel enregistrement ----
  if (!S) return { status: 'ok', write: true, deleted: false, json: rText, t };

  // ---- Enregistrement supprimé côté serveur ----
  if (S.deleted) {
    if (S.t > t) return keep('adopt');                // la suppression est plus récente
    return { status: 'ok', write: true, deleted: false, json: rText, t };
  }

  // ---- Fusion d'un enregistrement vivant ----
  const newer = t >= S.t;
  const merged: any = fieldsEditable ? clone(newer ? R2 : S.obj) : clone(S.obj);

  for (const c of COUNTERS[kind] ?? []) {
    const rv = Number(R2[c]);
    const sv = Number(S.obj[c]);
    const base = change.c?.[c];
    if (Number.isFinite(rv) && Number.isFinite(sv) && typeof base === 'number' && Number.isFinite(base)) {
      merged[c] = Math.max(0, round(sv + (rv - base)));
    } else if (!fieldsEditable) {
      merged[c] = S.obj[c];
    }
    // sans base connue : on garde la valeur choisie par la règle « le plus récent »
  }

  for (const [field, key] of Object.entries(UNIONS[kind] ?? {})) {
    const a: any[] = Array.isArray(S.obj[field]) ? S.obj[field] : [];
    const b: any[] = Array.isArray(R2[field]) ? R2[field] : [];
    const seen = new Map<string, any>();
    for (const item of [...b, ...a]) {
      const k = item && item[key] != null ? String(item[key]) : null;
      if (k !== null && !seen.has(k)) seen.set(k, item);
    }
    const list = [...seen.values()];
    list.sort((x, y) => String(y?.date ?? '').localeCompare(String(x?.date ?? ''))); // plus récent d'abord
    merged[field] = list;
  }
  merged.id = kind === 'settings' ? merged.id : change.id;

  const mergedStr = stableStringify(merged);
  const sameAsStored = mergedStr === stableStringify(S.obj);
  const sameAsSent = mergedStr === stableStringify(R2);
  const status: Status = sameAsSent ? 'ok' : 'adopt';

  if (sameAsStored) {
    return { status, write: false, deleted: false, json: S.json, t: S.t, reply: status === 'ok' ? undefined : { d: S.obj } };
  }
  return {
    status, write: true, deleted: false, json: JSON.stringify(merged), t: Math.max(S.t, t),
    reply: status === 'ok' ? undefined : { d: merged },
  };
}

// ---------- Statistiques précalculées ----------

export interface DayDelta { c: number; r: number; p: number; e: number }

/** Contribution d'un enregistrement aux statistiques journalières de la boutique. */
export function contribution(kind: Kind, obj: any, deleted: boolean): { day: string; v: DayDelta } | null {
  if (deleted || !obj || (kind !== 'sales' && kind !== 'expenses')) return null;
  const day = typeof obj.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(obj.date) ? obj.date.slice(0, 10) : null;
  if (!day) return null;
  if (kind === 'sales') {
    if (obj.status && obj.status !== 'completed') return null;
    return { day, v: { c: 1, r: Number(obj.total) || 0, p: Number(obj.profit) || 0, e: 0 } };
  }
  // Charges d'exploitation uniquement (même règle que l'application) : les achats de marchandises
  // sont déjà dans le coût des ventes, et les prélèvements personnels ne sont pas des charges.
  if (obj.category === 'supply' || obj.category === 'personal_draw') return null;
  return { day, v: { c: 0, r: 0, p: 0, e: Number(obj.amount) || 0 } };
}

export const isSettings = (k: Kind, id: string) => k === 'settings' && id === SETTINGS_ID;
