// Moteur de synchronisation (application) — dialogue avec /api/sync.
//
// Principe : l'application garde ses tableaux habituels (produits, ventes…). Le moteur compare chaque
// enregistrement à la dernière version connue du serveur (« shadow »), envoie uniquement ce qui a changé
// par lots (≤100), puis récupère les changements des autres appareils depuis son dernier curseur.
//  - hors-ligne : les modifications restent en attente (et survivent à un rechargement de la page) ;
//  - un lot est renvoyé tel quel après une coupure (identifiant de lot) : jamais appliqué deux fois ;
//  - stock et dettes sont envoyés avec leur valeur de départ : le serveur applique la différence.

import {
  COUNTERS, MAX_CHANGES, SETTINGS_ID, hashRecord, newId, type Kind,
} from '../../shared/syncCore';
import { api, ApiError, type SyncChange, type PullResponse } from './api';

export const DATA_KINDS = ['products', 'sales', 'expenses', 'customers', 'suppliers'] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export interface Snapshot {
  products: any[]; sales: any[]; expenses: any[]; customers: any[]; suppliers: any[]; settings: any;
}
export type SyncStatus = 'idle' | 'syncing' | 'pending' | 'offline' | 'error';
export interface SyncInfo { status: SyncStatus; pending: number; lastSync: number | null }

export interface SyncHost {
  getSnapshot(): Snapshot;
  /** Applique de nouvelles données (synchrone : l'état React est à jour au retour). */
  setSnapshot(patch: Partial<Snapshot>): void;
  /** Termine les mises à jour React en attente, pour que getSnapshot() soit exact. */
  flush(): void;
  onInfo(info: SyncInfo): void;
  onUnauthorized(): void;
  onReadOnly?(): void;
}

interface Inflight { batch: string; changes: SyncChange[] }
interface Persisted {
  v: 3; shopId: string; cursor: number;
  shadow: Record<string, string>;     // clé "kind:id" → "hash" ou "hash|compteur"
  pending: Record<string, number>;    // clé → heure de la dernière modification
  inflight: Inflight | null;
  skew: number;
  stale?: boolean;                    // les données locales ne sont plus celles de cette boutique
}

const STORE_KEY = 'soutrabiz_sync_v3';
const MAX_BODY_CHARS = 700_000;
const hashCache = new WeakMap<object, string>();
const hashOf = (rec: any): string => {
  if (rec && typeof rec === 'object') {
    let h = hashCache.get(rec);
    if (h === undefined) { h = hashRecord(rec); hashCache.set(rec, h); }
    return h;
  }
  return hashRecord(rec);
};
const counterField = (k: string): string | undefined => (COUNTERS as any)[k]?.[0];
const keyOf = (k: string, id: string) => k + ':' + id;
const splitKey = (key: string): [Kind, string] => {
  const i = key.indexOf(':');
  return [key.slice(0, i) as Kind, key.slice(i + 1)];
};
const sortDesc = (arr: any[]) => arr.sort((a, b) => String(b?.date ?? '').localeCompare(String(a?.date ?? '')));
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Lit toutes les pages d'une boutique (la sienne, ou celle consultée par l'admin). */
export async function fetchAllChanges(shopId?: string): Promise<{ changes: SyncChange[]; cursor: number; now: number }> {
  let since = 0;
  const changes: SyncChange[] = [];
  let now = Date.now();
  for (let guard = 0; guard < 500; guard++) {
    const r: PullResponse = await api.syncPull(since, shopId);
    changes.push(...r.changes);
    now = r.now;
    if (!r.more) return { changes, cursor: r.cursor, now };
    since = r.cursor;
  }
  throw new ApiError('Trop de données à charger.', 500);
}

/** Transforme une liste de changements en jeu de données complet. */
export function buildSnapshot(changes: SyncChange[], base?: Partial<Snapshot>): Snapshot {
  const out: Snapshot = {
    products: [], sales: [], expenses: [], customers: [], suppliers: [], settings: base?.settings ?? null,
  };
  for (const c of changes) {
    if (c.del || !c.d) continue;
    if (c.k === 'settings') out.settings = c.d;
    else if ((DATA_KINDS as readonly string[]).includes(c.k)) (out as any)[c.k].push(c.d);
  }
  sortDesc(out.sales); sortDesc(out.expenses);
  return out;
}

export class SyncEngine {
  private st: Persisted | null = null;
  private active = false;
  private running = false;
  private again = false;
  private status: SyncStatus = 'idle';
  private lastSync: number | null = null;
  private seen = new Map<string, string>();       // clé → dernier hash observé (pour dater les modifications)
  private timers: { debounce?: any; persist?: any; poll?: any } = {};
  private lastRunAt = 0;
  private listeners: Array<() => void> = [];

  constructor(private host: SyncHost) {}

  // ---------- cycle de vie ----------

  /** Démarre pour une boutique. Charge tout depuis le serveur si cet appareil ne la connaît pas encore. */
  async start(shopId: string): Promise<void> {
    this.stop();
    const p = this.load();
    const snap = this.host.getSnapshot();
    const localCount = DATA_KINDS.reduce((n, k) => n + snap[k].length, 0);
    const usable = p && p.shopId === shopId && !p.stale && !(localCount === 0 && Object.keys(p.shadow).length >= 5);
    if (usable) {
      this.st = p!;
    } else {
      this.st = { v: 3, shopId, cursor: 0, shadow: {}, pending: {}, inflight: null, skew: 0 };
      // Données locales de CETTE boutique jamais envoyées (ex. ventes faites hors-ligne avant la mise à jour,
      // ou état de synchronisation perdu) : on les garde et on les envoie au lieu de les écraser.
      const sameShop = !!snap.settings && snap.settings.shopId === shopId && localCount > 0;
      await this.bootstrap(sameShop ? snap : undefined);
    }
    this.active = true;
    this.attach();
    this.detect();
    this.persistNow();
    this.emit();
    this.request();
  }

  /** Arrête les envois (consultation admin, déconnexion). */
  stop(markStale = false) {
    this.active = false;
    for (const t of Object.values(this.timers)) clearTimeout(t as any);
    this.timers = {};
    this.listeners.forEach((off) => off());
    this.listeners = [];
    if (markStale && this.st) { this.st.stale = true; this.persistNow(); }
  }

  /** Déconnexion : oublie tout l'état de synchronisation. */
  destroy() {
    this.stop();
    this.st = null;
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  }

  /** L'application signale qu'une donnée a changé. */
  notify() {
    if (!this.active || !this.st) return;
    this.detect();
    this.schedulePersist();
    this.emit();
    clearTimeout(this.timers.debounce);
    this.timers.debounce = setTimeout(() => this.request(), 800);
  }

  /** Lance une synchronisation maintenant et attend la fin (déconnexion, avant consultation admin). */
  async syncNow(): Promise<void> {
    if (!this.active) return;
    this.detect();
    await this.request();
  }

  pendingCount(): number {
    return this.st ? Object.keys(this.st.pending).length + (this.st.inflight ? this.st.inflight.changes.length : 0) : 0;
  }

  // ---------- état persistant ----------

  private load(): Persisted | null {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return p && p.v === 3 && typeof p.shopId === 'string' ? (p as Persisted) : null;
    } catch { return null; }
  }
  private persistNow() {
    clearTimeout(this.timers.persist);
    if (!this.st) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.st)); }
    catch {
      // stockage plein : on retente sans le lot en cours (il restera en mémoire)
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...this.st, inflight: null })); } catch { /* ignore */ }
    }
  }
  private schedulePersist() {
    clearTimeout(this.timers.persist);
    this.timers.persist = setTimeout(() => this.persistNow(), 400);
  }

  private serverNow() { return Date.now() + (this.st?.skew ?? 0); }

  // ---------- détection des modifications locales ----------

  private shadowHash(key: string): string | undefined {
    const v = this.st!.shadow[key];
    if (v === undefined) return undefined;
    const i = v.indexOf('|');
    return i < 0 ? v : v.slice(0, i);
  }
  private shadowCounter(key: string): number | undefined {
    const v = this.st!.shadow[key];
    const i = v === undefined ? -1 : v.indexOf('|');
    return i < 0 ? undefined : Number(v.slice(i + 1));
  }
  private encode(kind: string, rec: any): string {
    const f = counterField(kind);
    const h = hashOf(rec);
    return f && Number.isFinite(Number(rec?.[f])) ? `${h}|${Number(rec[f])}` : h;
  }

  private detect() {
    const st = this.st;
    if (!st) return;
    const snap = this.host.getSnapshot();
    const now = this.serverNow();
    const present = new Set<string>();
    const check = (key: string, rec: any) => {
      present.add(key);
      const h = hashOf(rec);
      if (this.shadowHash(key) === h) { delete st.pending[key]; this.seen.set(key, h); return; }
      if (st.pending[key] === undefined || this.seen.get(key) !== h) st.pending[key] = now;
      this.seen.set(key, h);
    };
    for (const kind of DATA_KINDS) {
      for (const rec of snap[kind]) {
        if (rec && typeof rec.id === 'string' && rec.id) check(keyOf(kind, rec.id), rec);
      }
    }
    if (snap.settings && typeof snap.settings === 'object') check(keyOf('settings', SETTINGS_ID), snap.settings);
    // enregistrements connus du serveur mais absents en local = supprimés
    for (const key in st.shadow) {
      if (!present.has(key)) { if (st.pending[key] === undefined) st.pending[key] = now; }
    }
    // clés en attente qui n'existent plus ni en local ni sur le serveur
    for (const key in st.pending) {
      if (!present.has(key) && st.shadow[key] === undefined) delete st.pending[key];
    }
  }

  // ---------- boucle de synchronisation ----------

  private request(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.running) { this.again = true; return this.runPromise ?? Promise.resolve(); }
    this.runPromise = this.loop().finally(() => { this.runPromise = undefined; });
    return this.runPromise;
  }
  private runPromise?: Promise<void>;

  private async loop() {
    this.running = true;
    try {
      do {
        this.again = false;
        this.lastRunAt = Date.now();
        if (!navigator.onLine) { this.setStatus('offline'); break; }
        this.setStatus('syncing');
        try {
          await this.pushAll();
          await this.pullAll();
          this.host.flush();
          this.detect();
          this.lastSync = Date.now();
          this.setStatus(this.pendingCount() > 0 ? 'pending' : 'idle');
          this.persistNow();
        } catch (e) {
          this.persistNow();
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) { this.stop(); this.host.onUnauthorized(); return; }
          if (e instanceof ApiError && e.status === 402) { this.setStatus('idle'); this.host.onReadOnly?.(); break; }
          this.setStatus(e instanceof ApiError && e.status === 0 ? 'offline' : 'error');
          break;
        }
      } while (this.again && this.active);
    } finally {
      this.running = false;
    }
  }

  private setStatus(s: SyncStatus) { this.status = s; this.emit(); }
  private emit() {
    this.host.onInfo({ status: this.status === 'idle' && this.pendingCount() > 0 ? 'pending' : this.status, pending: this.pendingCount(), lastSync: this.lastSync });
  }

  private attach() {
    const run = () => { if (this.active) this.request(); };
    const onVis = () => { if (document.visibilityState === 'visible' && Date.now() - this.lastRunAt > 5000) run(); };
    window.addEventListener('online', run);
    window.addEventListener('focus', onVis);
    document.addEventListener('visibilitychange', onVis);
    this.listeners.push(
      () => window.removeEventListener('online', run),
      () => window.removeEventListener('focus', onVis),
      () => document.removeEventListener('visibilitychange', onVis),
    );
    // interrogation régulière : 60 s si tout va bien, 20 s si des données attendent ou en cas d'échec
    const poll = () => {
      this.timers.poll = setTimeout(() => {
        if (document.visibilityState === 'visible') run();
        poll();
      }, this.status === 'idle' ? 60_000 : 20_000);
    };
    poll();
  }

  // ---------- envoi ----------

  private buildBatch(): Inflight | null {
    const st = this.st!;
    const keys = Object.keys(st.pending).sort((a, b) => st.pending[a] - st.pending[b]);
    if (!keys.length) return null;
    const snap = this.host.getSnapshot();
    const maps = new Map<string, Map<string, any>>();
    const get = (kind: string, id: string) => {
      if (kind === 'settings') return id === SETTINGS_ID ? snap.settings : undefined;
      let m = maps.get(kind);
      if (!m) { m = new Map((snap as any)[kind].map((r: any) => [r?.id, r])); maps.set(kind, m); }
      return m.get(id);
    };
    const changes: SyncChange[] = [];
    let size = 0;
    for (const key of keys) {
      if (changes.length >= MAX_CHANGES) break;
      const [kind, id] = splitKey(key);
      const rec = get(kind, id);
      const t = st.pending[key];
      let ch: SyncChange;
      if (!rec) {
        ch = { k: kind, id, t, del: true };
      } else {
        ch = { k: kind, id, t, d: rec };
        const f = counterField(kind);
        const base = this.shadowCounter(key);
        if (f && base !== undefined && Number.isFinite(base)) ch.c = { [f]: base };
      }
      const len = JSON.stringify(ch).length;
      if (changes.length && size + len > MAX_BODY_CHARS) break;
      size += len;
      changes.push(ch);
      delete st.pending[key];
    }
    return changes.length ? { batch: newId('b'), changes } : null;
  }

  private async pushAll() {
    const st = this.st!;
    for (let guard = 0; guard < 1000; guard++) {
      if (!st.inflight) {
        this.host.flush();
        this.detect();
        const b = this.buildBatch();
        if (!b) return;
        st.inflight = b;
        this.persistNow();
      }
      const t0 = Date.now();
      const res = await api.syncPush(st.inflight.batch, st.inflight.changes);
      st.skew = res.now - (t0 + Date.now()) / 2;
      this.handleResults(st.inflight, res.results);
      st.inflight = null;
      this.persistNow();
      this.emit();
    }
  }

  private handleResults(inflight: Inflight, results: Array<{ k: string; id: string; s: string; d?: any; del?: number }>) {
    const st = this.st!;
    this.host.flush();
    const snap = this.host.getSnapshot();
    const patch: Partial<Snapshot> = {};
    const arrays: Record<string, any[]> = {};
    const working = (kind: string) => (arrays[kind] ??= [...(snap as any)[kind]]);
    const sentBy = new Map(inflight.changes.map((c) => [keyOf(c.k, c.id), c]));
    let changedSales = false;

    for (const r of results) {
      const key = keyOf(r.k, r.id);
      const sent = sentBy.get(key);
      if (!sent) continue;
      const sentHash = sent.del ? 'del' : hashOf(sent.d);

      if (r.s === 'ok') {
        if (sent.del) delete st.shadow[key];
        else st.shadow[key] = this.encode(r.k, sent.d);
        continue;
      }
      // 'adopt' ou 'denied' : le serveur renvoie la version à utiliser
      if (r.del) {
        delete st.shadow[key];
        delete st.pending[key];
        if (r.k !== 'settings') {
          const arr = working(r.k);
          const i = arr.findIndex((x) => x?.id === r.id);
          if (i >= 0) arr.splice(i, 1);
        }
        continue;
      }
      const server = r.d;
      if (!server) continue;
      st.shadow[key] = this.encode(r.k, server);
      if (r.k === 'settings') {
        patch.settings = server;
        continue;
      }
      const arr = working(r.k);
      const i = arr.findIndex((x) => x?.id === r.id);
      if (i < 0) {
        if (sent.del) { arr.unshift(server); if (r.k === 'sales') changedSales = true; }
        // sinon : supprimé localement après l'envoi → la suppression reste en attente
        continue;
      }
      if (hashOf(arr[i]) === sentHash) arr[i] = server;                    // inchangé depuis l'envoi : on adopte
      else arr[i] = this.rebase(r.k, arr[i], server, sent.d);              // modifié pendant l'envoi : on garde le delta local
    }
    for (const kind of Object.keys(arrays)) {
      if (kind === 'sales' || kind === 'expenses') sortDesc(arrays[kind]);
      (patch as any)[kind] = arrays[kind];
    }
    void changedSales;
    if (Object.keys(patch).length) this.host.setSnapshot(patch);
  }

  /** Une modification locale faite pendant l'envoi est rejouée par-dessus la version du serveur. */
  private rebase(kind: string, local: any, server: any, sentRec: any): any {
    const out = { ...local };
    const f = counterField(kind);
    if (f) {
      const delta = Number(local[f]) - Number(sentRec?.[f] ?? local[f]);
      out[f] = Math.max(0, round6(Number(server[f]) + (Number.isFinite(delta) ? delta : 0)));
    }
    if (kind === 'customers' || kind === 'suppliers') {
      const seen = new Map<string, any>();
      for (const p of [...(local.payments || []), ...(server.payments || [])]) if (p?.id && !seen.has(p.id)) seen.set(p.id, p);
      out.payments = [...seen.values()].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    }
    return out;
  }

  // ---------- réception ----------

  private async pullAll() {
    const st = this.st!;
    for (let guard = 0; guard < 500; guard++) {
      const t0 = Date.now();
      const r = await api.syncPull(st.cursor);
      st.skew = r.now - (t0 + Date.now()) / 2;
      this.applyRemote(r.changes);
      st.cursor = r.cursor;
      if (!r.more) return;
    }
  }

  private applyRemote(changes: SyncChange[]) {
    if (!changes.length) return;
    const st = this.st!;
    this.host.flush();
    const snap = this.host.getSnapshot();
    const patch: Partial<Snapshot> = {};
    const arrays: Record<string, any[]> = {};
    const index: Record<string, Map<string, number>> = {};
    let inserted = false;

    const ensure = (kind: string) => {
      if (!arrays[kind]) {
        arrays[kind] = [...(snap as any)[kind]];
        index[kind] = new Map(arrays[kind].map((r, i) => [r?.id, i]));
      }
    };
    let removed = false;

    for (const c of changes) {
      const key = keyOf(c.k, c.id);
      if (c.k === 'settings') {
        if (c.del || !c.d || c.id !== SETTINGS_ID) continue;
        const local = (patch.settings ?? snap.settings) as any;
        const dirty = local && this.shadowHash(key) !== hashOf(local);
        if (dirty) continue;
        st.shadow[key] = this.encode('settings', c.d);
        patch.settings = c.d;
        continue;
      }
      if (!(DATA_KINDS as readonly string[]).includes(c.k)) continue;
      ensure(c.k);
      const arr = arrays[c.k];
      const pos = index[c.k].get(c.id);
      const local = pos !== undefined ? arr[pos] : undefined;
      const sh = this.shadowHash(key);
      // modification locale non envoyée (ou suppression locale en attente) : le serveur arbitrera à l'envoi
      const dirty = local ? sh !== hashOf(local) : sh !== undefined;
      if (dirty) continue;
      if (c.del) {
        if (local !== undefined) { arr[pos!] = undefined as any; removed = true; }
        delete st.shadow[key];
        continue;
      }
      if (!c.d) continue;
      st.shadow[key] = this.encode(c.k, c.d);
      if (local === undefined) {
        arr.push(c.d); index[c.k].set(c.id, arr.length - 1); inserted = true;
      } else if (hashOf(local) !== hashOf(c.d)) {
        arr[pos!] = c.d;
      }
    }
    for (const kind of Object.keys(arrays)) {
      let a = arrays[kind];
      if (removed) a = a.filter((x) => x !== undefined);
      if (inserted && (kind === 'sales' || kind === 'expenses')) sortDesc(a);
      else if (inserted && kind !== 'sales' && kind !== 'expenses') a = this.newestFirst(a, snap, kind);
      if (a.length !== (snap as any)[kind].length || a.some((x, i) => x !== (snap as any)[kind][i])) (patch as any)[kind] = a;
    }
    if (Object.keys(patch).length) this.host.setSnapshot(patch);
  }

  /** Les nouveaux éléments (ajoutés en fin de liste) passent devant. */
  private newestFirst(a: any[], snap: Snapshot, kind: string): any[] {
    const old = new Set((snap as any)[kind].map((r: any) => r?.id));
    const fresh = a.filter((r) => r && !old.has(r.id));
    const rest = a.filter((r) => r && old.has(r.id));
    return [...fresh, ...rest];
  }

  // ---------- premier chargement ----------

  /** Le serveur fait foi : remplace les données locales, sauf les enregistrements que le serveur ne connaît pas
   *  (keepLocal) : ceux-là sont conservés et seront envoyés. */
  async bootstrap(keepLocal?: Snapshot): Promise<void> {
    const st = this.st!;
    const t0 = Date.now();
    const { changes, cursor, now } = await fetchAllChanges();
    st.skew = now - (t0 + Date.now()) / 2;
    st.shadow = {}; st.pending = {}; st.inflight = null; st.stale = false;
    st.cursor = cursor;
    const snap = buildSnapshot(changes);
    for (const c of changes) {
      if (c.del || !c.d) continue;
      st.shadow[keyOf(c.k, c.id)] = this.encode(c.k, c.d);
    }
    this.seen.clear();
    if (keepLocal) {
      const known = new Set(changes.map((c) => keyOf(c.k, c.id))); // y compris les suppressions (le serveur gagne)
      for (const kind of DATA_KINDS) {
        const extra = keepLocal[kind].filter((r: any) => r && typeof r.id === 'string' && r.id && !known.has(keyOf(kind, r.id)));
        if (extra.length) (snap as any)[kind] = [...snap[kind], ...extra];
      }
      sortDesc(snap.sales); sortDesc(snap.expenses);
    }
    const patch: Partial<Snapshot> = { products: snap.products, sales: snap.sales, expenses: snap.expenses, customers: snap.customers, suppliers: snap.suppliers };
    if (snap.settings) patch.settings = snap.settings;
    this.host.setSnapshot(patch);
    this.host.flush();
    this.persistNow();
  }

  /** Affiche les données d'une autre boutique (consultation admin) sans jamais les envoyer. */
  applyForeign(snap: Snapshot) {
    const patch: Partial<Snapshot> = {
      products: snap.products, sales: snap.sales, expenses: snap.expenses, customers: snap.customers, suppliers: snap.suppliers,
    };
    if (snap.settings) patch.settings = snap.settings;
    this.host.setSnapshot(patch);
  }

  /** Après une consultation admin : recharge sa propre boutique depuis le serveur. */
  async restart(shopId: string): Promise<void> {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    await this.start(shopId);
  }
}
