// worker.js
// Ce fichier remplace le dossier functions/. Il gère à la fois :
// - le site (fichiers du dossier public/, via le binding ASSETS)
// - l'API /api/courses-du-jour (cotes et résultats en direct)

const PMU_BASE = "https://offline.turfinfo.api.pmu.fr/rest/client/61";
const CACHE_TTL_MS = 45_000;
const CACHE_KEY = "courses-du-jour";

function todayParam() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}${mm}${d.getFullYear()}`;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`PMU a répondu ${res.status} sur ${url}`);
  return res.json();
}

async function getFavori(date, numReunion, numCourse) {
  try {
    const data = await fetchJSON(
      `${PMU_BASE}/programme/${date}/R${numReunion}/C${numCourse}/participants`
    );
    const participants = data.participants || [];
    let favori = null;
    for (const p of participants) {
      const cote = p.dernierRapportDirect?.rapport;
      if (cote == null) continue;
      if (!favori || cote < favori.cote) {
        favori = {
          numero: p.numPmu,
          nom: p.nom,
          jockey: p.driver?.nom || p.entraineur?.nom || "",
          cote,
        };
      }
    }
    return { favori, nbPartants: participants.length };
  } catch {
    return { favori: null, nbPartants: null };
  }
}

// Course terminée = au moins un partant a un ordreArrivee défini.
// On construit le podium (les 5 premiers) à partir de ce champ.
async function getArrivee(date, numReunion, numCourse) {
  try {
    const data = await fetchJSON(
      `${PMU_BASE}/programme/${date}/R${numReunion}/C${numCourse}/participants`
    );
    const participants = data.participants || [];
    const arrives = participants.filter((p) => p.ordreArrivee != null && p.ordreArrivee > 0);
    if (arrives.length === 0) return null;

    arrives.sort((a, b) => a.ordreArrivee - b.ordreArrivee);
    return arrives.slice(0, 5).map((p) => ({
      position: p.ordreArrivee,
      numero: p.numPmu,
      nom: p.nom,
      jockey: p.driver?.nom || p.entraineur?.nom || "",
      cote: p.dernierRapportDirect?.rapport ?? null,
    }));
  } catch {
    return null;
  }
}

const RESULTATS_CACHE_KEY = "resultats-du-jour";
const RESULTATS_TTL_MS = 60_000;

async function verifierPrediction(env, date, reunion, course, podium) {
  if (!env.DB) return null;
  try {
    const pred = await env.DB.prepare(
      `SELECT id, quarte6, coups_surs FROM predictions WHERE date = ? AND reunion = ? AND course = ?`
    )
      .bind(date, reunion, course)
      .first();
    if (!pred) return null;

    const podiumNumeros = podium.map((p) => p.numero);
    const quarte6 = JSON.parse(pred.quarte6);
    const selectionNumeros = quarte6.map((h) => h.numero);
    const coupsSurs = JSON.parse(pred.coups_surs || "[]");

    const chevauxCorrects = quarte6.filter((h) => podiumNumeros.includes(h.numero)).length;
    const coupsSursReussis = coupsSurs.filter((numero) => podiumNumeros.includes(numero)).length;
    // "Tiercé réussi" = les 3 premiers de l'arrivée officielle figurent tous dans
    // notre sélection de 8, peu importe leur ordre entre eux ("dans le désordre").
    // "Quarté réussi" = pareil mais sur les 4 premiers. Un quarté réussi implique
    // toujours un tiercé réussi (sous-ensemble des mêmes 4 chevaux).
    const podiumTierce = podium.slice(0, Math.min(3, podium.length));
    const podiumQuarte = podium.slice(0, Math.min(4, podium.length));
    const tierceReussi = podiumTierce.every((p) => selectionNumeros.includes(p.numero));
    const quarteReussi = podiumQuarte.every((p) => selectionNumeros.includes(p.numero));

    const dejaVerifie = await env.DB.prepare(
      `SELECT prediction_id FROM resultats_verifies WHERE prediction_id = ?`
    )
      .bind(pred.id)
      .first();

    if (!dejaVerifie) {
      await env.DB.prepare(
        `INSERT INTO resultats_verifies (prediction_id, podium_reel, chevaux_corrects, coups_surs_reussis, tierce_reussi, verified_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(pred.id, JSON.stringify(podium), chevauxCorrects, coupsSursReussis, tierceReussi ? 1 : 0, Date.now())
        .run();

      await completerFeaturesAvecResultat(env, date, reunion, course, podium);
    }

    return { quarteReussi, tierceReussi, chevauxCorrects };
  } catch {
    // Vérification best-effort, ne casse jamais l'affichage des résultats
    return null;
  }
}

// Complète courses_features avec le résultat réel de chaque cheval, une fois la course terminée.
async function completerFeaturesAvecResultat(env, date, reunion, course, podium) {
  const positionParNumero = new Map(podium.map((p) => [p.numero, p.position]));
  const rows = await env.DB.prepare(
    `SELECT num_pmu FROM courses_features WHERE date = ? AND reunion = ? AND course = ?`
  )
    .bind(date, reunion, course)
    .all();

  for (const row of rows.results || []) {
    const position = positionParNumero.get(row.num_pmu) ?? null;
    // Cheval non classé dans le top4 renvoyé par l'API PMU (au-delà de la 4e place) : top4_reel = 0.
    const top4 = position != null ? 1 : 0;
    await env.DB.prepare(
      `UPDATE courses_features SET position_reelle = ?, top4_reel = ? WHERE date = ? AND reunion = ? AND course = ? AND num_pmu = ?`
    )
      .bind(position, top4, date, reunion, course, row.num_pmu)
      .run();
  }
}

// Rattrapage nocturne : vérifie les pronostics jamais confirmés (ex. course
// terminée tard, aucun visiteur n'a rechargé la page résultats ce jour-là).
// Sans ça, une prédiction restait non vérifiée pour toujours, puisque la
// vérification "live" (dans loadResultatsDuJour) ne regarde que le jour même.
async function verifierPredictionsEnAttente(env) {
  if (!env.DB) return;
  try {
    const enAttente = await env.DB.prepare(
      `SELECT p.date, p.reunion, p.course
       FROM predictions p
       LEFT JOIN resultats_verifies r ON r.prediction_id = p.id
       WHERE r.prediction_id IS NULL
       ORDER BY p.created_at DESC
       LIMIT 200`
    ).all();

    for (const row of enAttente.results || []) {
      const numReunion = row.reunion.replace(/^R/, "");
      const numCourse = row.course.replace(/^C/, "");
      const podium = await getArrivee(row.date, numReunion, numCourse);
      // null = course pas encore courue, annulée, ou résultat PMU pas encore publié :
      // on la retentera à la prochaine exécution du cron sans risque de doublon.
      if (!podium) continue;
      await verifierPrediction(env, row.date, row.reunion, row.course, podium);
    }
  } catch (e) {
    console.error("[verif-nocturne]", e.message);
  }
}

// ============================================================================
// ARCHIVE LONG TERME — TOUTES les courses (pas seulement celles pronostiquées)
// ----------------------------------------------------------------------------
// Avant : courses_features / resultats_verifies ne contenaient que les courses
// pour lesquelles un visiteur avait demandé un pronostic, et seul le podium
// (5 premiers) de la course du jour était vérifié.
// Maintenant : chaque course du programme PMU (réunions, partants, cotes,
// arrivée complète, historique détaillé des chevaux) est archivée dans deux
// tables dédiées, indépendamment de tout pronostic. Jointure possible avec
// `predictions` / `resultats_verifies` via (date, reunion, course).
// Format de `date` = celui de PMU (DDMMYYYY), comme le reste de la base ;
// `date_iso` (YYYY-MM-DD) sert au tri et aux requêtes par période.
// ============================================================================
const ARCHIVE_PROFONDEUR_JOURS = 60;     // jusqu'où remonter (jours) lors du rattrapage
const ARCHIVE_MAX_COURSES_PAR_RUN = 12;  // limite de sous-requêtes Workers : ~3 par course
const ARCHIVE_KV_JOURS_OK = "archive:jours-ok";
const CRON_ARCHIVE = "*/30 * * * *";     // à déclarer dans wrangler.jsonc (triggers.crons)
let archiveTablesPretes = false;

function dateParamDepuis(d) {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}${mm}${d.getUTCFullYear()}`;
}
function dateISODepuisParam(p) {
  return `${p.slice(4)}-${p.slice(2, 4)}-${p.slice(0, 2)}`;
}

async function assurerTablesArchive(env) {
  if (!env.DB || archiveTablesPretes) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS archive_courses (
         date TEXT NOT NULL, date_iso TEXT NOT NULL, reunion TEXT NOT NULL, course TEXT NOT NULL,
         hippodrome TEXT, discipline TEXT, distance INTEGER, allocation INTEGER, nb_partants INTEGER,
         heure TEXT,
         termine INTEGER NOT NULL DEFAULT 0,   -- 0 = pas encore d'arrivée, 1 = arrivée archivée, 2 = jamais d'arrivée (annulée/non publiée)
         arrivee_json TEXT,                    -- arrivée complète [{place, numero, nom}]
         archived_at INTEGER, updated_at INTEGER,
         PRIMARY KEY (date, reunion, course)
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS archive_partants (
         date TEXT NOT NULL, date_iso TEXT NOT NULL, reunion TEXT NOT NULL, course TEXT NOT NULL, num_pmu INTEGER NOT NULL,
         cheval TEXT, driver TEXT, entraineur TEXT, age INTEGER, sexe TEXT, musique TEXT,
         cote REAL, corde INTEGER, poids REAL, oeilleres TEXT, gains_carriere REAL,
         non_partant INTEGER DEFAULT 0,
         place_arrivee INTEGER,                -- place réelle (NULL = non classé / pas d'arrivée)
         historique_json TEXT,                 -- 5 dernières courses (performances-détaillées PMU)
         updated_at INTEGER,
         PRIMARY KEY (date, reunion, course, num_pmu)
       )`
    ),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_archive_courses_date ON archive_courses (date_iso)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_archive_partants_cheval ON archive_partants (cheval, date_iso)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_archive_partants_date ON archive_partants (date_iso)`),
  ]);
  archiveTablesPretes = true;
}

// Version compacte et stable de l'historique PMU d'un cheval (5 dernières courses).
function compacterHistorique(perf) {
  if (!perf || !Array.isArray(perf.coursesCourues)) return null;
  const lignes = perf.coursesCourues.slice(0, 5).map((c) => {
    const soi = (c.participants || []).find((p) => p.itsHim);
    return {
      date: c.date ?? null,
      hippodrome: c.hippodrome || null,
      discipline: c.discipline || null,
      distance: c.distance ?? null,
      allocation: c.allocation ?? null,
      nb: c.nbParticipants ?? null,
      place: soi?.place?.place ?? null,
      statut: soi?.place?.statusArrivee ?? null,
      rk: soi?.reductionKilometrique ?? null,
    };
  });
  return lignes.length ? JSON.stringify(lignes) : null;
}

// Archive UNE course (partants + arrivée complète + historique). Retourne true si une arrivée a été trouvée.
async function archiverCourse(env, dateParam, numReunion, infoCourse, hippodrome, avantHier) {
  const reunionCode = `R${numReunion}`;
  const numCourse = infoCourse.numOrdre ?? infoCourse.numExterne;
  const courseCode = `C${numCourse}`;
  const dateISO = dateISODepuisParam(dateParam);

  const [data, perfs] = await Promise.all([
    fetchJSON(`${PMU_BASE}/programme/${dateParam}/${reunionCode}/${courseCode}/participants`),
    fetchPerformancesDetaillees(dateParam, reunionCode, courseCode),
  ]);
  const participants = data.participants || [];
  const arrives = participants
    .filter((p) => p.ordreArrivee != null && p.ordreArrivee > 0)
    .sort((a, b) => a.ordreArrivee - b.ordreArrivee);
  const arriveeComplete = arrives.map((p) => ({ place: p.ordreArrivee, numero: p.numPmu, nom: p.nom }));

  // Une course d'un jour déjà ancien sans aucune arrivée ne sera jamais complétée (annulée,
  // résultat non publié) : on la marque 2 pour ne plus la retenter à chaque passage.
  const termine = arrives.length > 0 ? 1 : dateISO < avantHier ? 2 : 0;
  const now = Date.now();

  const stmts = [
    env.DB.prepare(
      `INSERT INTO archive_courses
         (date, date_iso, reunion, course, hippodrome, discipline, distance, allocation, nb_partants, heure, termine, arrivee_json, archived_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (date, reunion, course) DO UPDATE SET
         hippodrome = excluded.hippodrome, discipline = excluded.discipline, distance = excluded.distance,
         allocation = excluded.allocation, nb_partants = excluded.nb_partants, heure = excluded.heure,
         termine = excluded.termine, arrivee_json = excluded.arrivee_json, updated_at = excluded.updated_at`
    ).bind(
      dateParam, dateISO, reunionCode, courseCode, hippodrome || "",
      infoCourse.discipline || infoCourse.specialite || "", infoCourse.distance ?? null,
      infoCourse.montantPrix ?? infoCourse.montantTotalOffert ?? null,
      participants.filter((p) => !p.nonPartant).length, formatHeure(infoCourse.heureDepart),
      termine, arriveeComplete.length ? JSON.stringify(arriveeComplete) : null, now, now
    ),
  ];

  for (const p of participants) {
    if (p.numPmu == null) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO archive_partants
           (date, date_iso, reunion, course, num_pmu, cheval, driver, entraineur, age, sexe, musique, cote, corde, poids, oeilleres, gains_carriere, non_partant, place_arrivee, historique_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (date, reunion, course, num_pmu) DO UPDATE SET
           cote = excluded.cote, non_partant = excluded.non_partant, place_arrivee = excluded.place_arrivee,
           musique = excluded.musique, gains_carriere = excluded.gains_carriere,
           historique_json = COALESCE(excluded.historique_json, archive_partants.historique_json),
           updated_at = excluded.updated_at`
      ).bind(
        dateParam, dateISO, reunionCode, courseCode, p.numPmu, p.nom || "",
        p.driver?.nom || "", p.entraineur?.nom || "", p.age ?? null, p.sexe || "", p.musique || "",
        p.dernierRapportDirect?.rapport ?? null, p.placeCorde ?? null, p.handicapPoids ?? null,
        p.oeilleres || "", p.gainsParticipant?.gainsCarriere ?? null, p.nonPartant ? 1 : 0,
        p.ordreArrivee > 0 ? p.ordreArrivee : null, compacterHistorique(perfs[p.numPmu]), now
      )
    );
  }

  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return arrives.length > 0;
}

// Archive les courses d'une journée qui ne sont pas encore terminées en base, dans la limite du budget.
async function archiverJournee(env, dateParam, budget, avantHier) {
  const programme = await fetchJSON(`${PMU_BASE}/programme/${dateParam}`);
  const toutes = [];
  for (const r of programme.programme?.reunions || []) {
    const numReunion = r.numOfficiel ?? r.numExterne;
    const hippodrome = r.hippodrome?.libelleCourt || r.libelleCourt || "";
    for (const c of r.courses || []) toutes.push({ numReunion, hippodrome, c });
  }

  const faites = await env.DB.prepare(
    `SELECT reunion, course FROM archive_courses WHERE date = ? AND termine IN (1, 2)`
  ).bind(dateParam).all();
  const dejaOk = new Set((faites.results || []).map((r) => `${r.reunion}${r.course}`));
  const aFaire = toutes.filter(({ numReunion, c }) => !dejaOk.has(`R${numReunion}C${c.numOrdre ?? c.numExterne}`));

  let traitees = 0;
  let erreurs = 0;
  for (const { numReunion, hippodrome, c } of aFaire) {
    if (traitees >= budget) break;
    try {
      await archiverCourse(env, dateParam, numReunion, c, hippodrome, avantHier);
    } catch (e) {
      erreurs++;
      console.error(`[archive] R${numReunion} ${dateParam} —`, e.message);
    }
    traitees++;
  }
  return { total: toutes.length, traitees, erreurs, restantes: Math.max(0, aFaire.length - traitees) };
}

// Parcourt les jours du plus récent au plus ancien (aujourd'hui, hier, puis rattrapage de l'historique)
// et archive tout ce qui manque, dans la limite de `budget` courses par appel.
async function archiverHistoriqueCourses(env, { profondeur = ARCHIVE_PROFONDEUR_JOURS, budget = ARCHIVE_MAX_COURSES_PAR_RUN } = {}) {
  if (!env.DB) return { ok: false, raison: "Base D1 indisponible" };
  await assurerTablesArchive(env);

  const jourOk = new Set((await env.CACHE_KV.get(ARCHIVE_KV_JOURS_OK, { type: "json" })) || []);
  const maintenant = new Date();
  const avantHier = dateISODepuisParam(dateParamDepuis(new Date(maintenant.getTime() - 2 * 86400000)));
  let reste = budget;
  const bilan = { ok: true, traitees: 0, erreurs: 0, jours: [], termine: false };

  for (let i = 0; i <= profondeur && reste > 0; i++) {
    const dateParam = dateParamDepuis(new Date(maintenant.getTime() - i * 86400000));
    const dateISO = dateISODepuisParam(dateParam);
    if (jourOk.has(dateISO)) continue;
    try {
      const r = await archiverJournee(env, dateParam, reste, avantHier);
      reste -= r.traitees;
      bilan.traitees += r.traitees;
      bilan.erreurs += r.erreurs;
      bilan.jours.push({ date: dateISO, ...r });
      // Un jour n'est « clos » (plus jamais revisité) que s'il est ancien et sans course restante.
      if (r.restantes === 0 && r.erreurs === 0 && dateISO < avantHier) jourOk.add(dateISO);
    } catch (e) {
      bilan.jours.push({ date: dateISO, erreur: e.message });
      console.error(`[archive] programme ${dateParam} —`, e.message);
    }
  }
  bilan.termine = reste > 0; // budget non épuisé = tout est à jour sur la période
  await env.CACHE_KV.put(ARCHIVE_KV_JOURS_OK, JSON.stringify([...jourOk]));
  return bilan;
}

async function statsArchive(env) {
  await assurerTablesArchive(env);
  const c = await env.DB.prepare(
    `SELECT COUNT(*) AS courses, SUM(termine = 1) AS avec_arrivee, SUM(termine = 2) AS sans_arrivee,
            MIN(date_iso) AS du, MAX(date_iso) AS au, COUNT(DISTINCT date_iso) AS jours
     FROM archive_courses`
  ).first();
  const p = await env.DB.prepare(
    `SELECT COUNT(*) AS lignes, COUNT(DISTINCT cheval) AS chevaux, SUM(historique_json IS NOT NULL) AS avec_historique
     FROM archive_partants`
  ).first();
  return { ...c, ...p };
}

async function handleAdminArchive(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  if (!env.DB) return new Response(JSON.stringify({ error: "Base D1 indisponible" }), { status: 503, headers: corsHeaders });

  try {
    if (request.method === "POST") {
      let body = {};
      try { body = await request.json(); } catch { /* corps optionnel */ }
      const budget = Math.max(1, Math.min(25, parseInt(body.budget, 10) || ARCHIVE_MAX_COURSES_PAR_RUN));
      const profondeur = Math.max(0, Math.min(365, parseInt(body.profondeur, 10) || ARCHIVE_PROFONDEUR_JOURS));
      const bilan = await archiverHistoriqueCourses(env, { profondeur, budget });
      return new Response(JSON.stringify({ bilan, stats: await statsArchive(env) }), { headers: corsHeaders });
    }
    return new Response(JSON.stringify({ stats: await statsArchive(env) }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}

// ============================================================================
// MESURE DES IA — laquelle gagne vraiment ?
// ----------------------------------------------------------------------------
// `predictions` ne garde que le consensus. Cette table garde le classement de CHAQUE IA
// (DeepSeek, GPT Sol, …) pour pouvoir les comparer à l'arrivée réelle (archive_courses)
// et à une référence simple : les 8 plus petites cotes (« le marché »).
// Les mesures ne commencent qu'à partir de la mise en production : rien n'est rétro-calculable
// sans repayer les IA.
// ============================================================================
let tablePredictionsIAPrete = false;

async function assurerTablePredictionsIA(env) {
  if (!env.DB || tablePredictionsIAPrete) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS predictions_ia (
         date TEXT NOT NULL, reunion TEXT NOT NULL, course TEXT NOT NULL, ia TEXT NOT NULL,
         modele TEXT,            -- modèle réellement utilisé (ex. deepseek-v4-flash si repli)
         avec_web INTEGER,       -- 1 = recherche web activée pour cette IA, 0 = non
         quarte8 TEXT NOT NULL,  -- classement de l'IA : [{numero, cheval}] (1er choix en premier)
         coups_surs TEXT,
         confiance INTEGER,
         created_at INTEGER,
         PRIMARY KEY (date, reunion, course, ia)
       )`
    ),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_predictions_ia_ia ON predictions_ia (ia, created_at)`),
  ]);
  tablePredictionsIAPrete = true;
}

async function enregistrerPredictionsParIA(env, date, reunion, course, predictions, createdAt) {
  try {
    await assurerTablePredictionsIA(env);
    const stmts = predictions.map((p) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO predictions_ia (date, reunion, course, ia, modele, avec_web, quarte8, coups_surs, confiance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        date, reunion, course, p.source || "IA", p.modele || null, p.web ?? null,
        JSON.stringify((p.quarte8 || []).map((c) => ({ numero: c.numero, cheval: c.cheval }))),
        JSON.stringify(p.coupsSurs || []), p.confiance ?? null, createdAt
      )
    );
    if (stmts.length) await env.DB.batch(stmts);
  } catch (e) {
    console.error("[predictions_ia]", e.message); // best-effort : ne casse jamais le pronostic
  }
}

// Résultat d'une sélection de 8 chevaux face à l'arrivée réelle.
function evaluerSelection(numeros, coupsSurs, arrivee) {
  const top4 = new Set(arrivee.filter((a) => a.place <= 4).map((a) => a.numero));
  const top3 = arrivee.filter((a) => a.place <= 3).map((a) => a.numero);
  const gagnants = arrivee.filter((a) => a.place === 1).map((a) => a.numero);
  const sel = new Set(numeros);
  return {
    corrects: numeros.filter((n) => top4.has(n)).length,
    tierce: top3.length >= 3 && top3.every((n) => sel.has(n)),
    quarte: top4.size >= 4 && [...top4].every((n) => sel.has(n)),
    premierTop4: numeros.length > 0 && top4.has(numeros[0]),
    premierGagne: numeros.length > 0 && gagnants.includes(numeros[0]),
    coupsSursTentes: (coupsSurs || []).length,
    coupsSursReussis: (coupsSurs || []).filter((n) => top4.has(n)).length,
  };
}

function agregerEvaluations(evals) {
  const n = evals.length;
  if (!n) return { n: 0 };
  const pct = (f) => Math.round((evals.filter(f).length / n) * 1000) / 10;
  const cs = evals.reduce((a, e) => a + e.coupsSursTentes, 0);
  const csOk = evals.reduce((a, e) => a + e.coupsSursReussis, 0);
  return {
    n,
    chevaux_corrects_moy: Math.round((evals.reduce((a, e) => a + e.corrects, 0) / n) * 100) / 100, // sur 4 possibles
    pct_tierce_desordre: pct((e) => e.tierce),
    pct_quarte_desordre: pct((e) => e.quarte),
    pct_premier_choix_dans_top4: pct((e) => e.premierTop4),
    pct_premier_choix_gagnant: pct((e) => e.premierGagne),
    pct_coups_surs_dans_top4: cs ? Math.round((csOk / cs) * 1000) / 10 : null,
  };
}

function lireArrivee(json) {
  try {
    return (JSON.parse(json) || []).map((a) => ({ place: Number(a.place), numero: Number(a.numero) })).filter((a) => a.place > 0);
  } catch {
    return [];
  }
}
function lireNumeros(json) {
  try {
    return (JSON.parse(json) || []).map((c) => Number(c.numero));
  } catch {
    return [];
  }
}
function lireListe(json) {
  try {
    return (JSON.parse(json || "[]") || []).map(Number);
  } catch {
    return [];
  }
}

async function calculerPerformanceIA(env, jours = 60) {
  await assurerTablesArchive(env);
  await assurerTablePredictionsIA(env);
  const depuis = new Date(Date.now() - jours * 86400000).toISOString().slice(0, 10);

  // 1) Classements de chaque IA + 2) consensus historique, face à l'arrivée archivée.
  const [parIA, consensus, courses, favoris] = await Promise.all([
    env.DB.prepare(
      `SELECT pia.ia, pia.avec_web, pia.date, pia.reunion, pia.course, pia.quarte8, pia.coups_surs, ac.arrivee_json
       FROM predictions_ia pia
       JOIN archive_courses ac ON ac.date = pia.date AND ac.reunion = pia.reunion AND ac.course = pia.course
       WHERE ac.termine = 1 AND ac.date_iso >= ?`
    ).bind(depuis).all(),
    env.DB.prepare(
      `SELECT p.date, p.reunion, p.course, p.quarte6 AS quarte8, p.coups_surs, p.confiance, ac.arrivee_json
       FROM predictions p
       JOIN archive_courses ac ON ac.date = p.date AND ac.reunion = p.reunion AND ac.course = p.course
       WHERE ac.termine = 1 AND ac.date_iso >= ?`
    ).bind(depuis).all(),
    env.DB.prepare(`SELECT date, reunion, course, arrivee_json FROM archive_courses WHERE termine = 1 AND date_iso >= ?`)
      .bind(depuis).all(),
    // Référence « le marché » : les 8 plus petites cotes de chaque course.
    env.DB.prepare(
      `SELECT date, reunion, course, num_pmu FROM (
         SELECT date, reunion, course, num_pmu,
                ROW_NUMBER() OVER (PARTITION BY date, reunion, course ORDER BY cote ASC, num_pmu ASC) AS rn
         FROM archive_partants WHERE non_partant = 0 AND cote IS NOT NULL AND date_iso >= ?
       ) WHERE rn <= 8`
    ).bind(depuis).all(),
  ]);

  const cle = (r) => `${r.date}|${r.reunion}|${r.course}`;
  const evalsParLabel = {};
  const ajouter = (label, e) => (evalsParLabel[label] ||= []).push(e);
  const coursesAvecProno = new Set();

  for (const r of parIA.results || []) {
    const label = r.avec_web === 1 ? `${r.ia} (avec web)` : r.avec_web === 0 ? `${r.ia} (sans web)` : r.ia;
    const arrivee = lireArrivee(r.arrivee_json);
    ajouter(label, evaluerSelection(lireNumeros(r.quarte8), lireListe(r.coups_surs), arrivee));
    coursesAvecProno.add(cle(r));
  }

  const buckets = { "confiance < 40": [], "confiance 40-64": [], "confiance ≥ 65": [] };
  for (const r of consensus.results || []) {
    const arrivee = lireArrivee(r.arrivee_json);
    const e = evaluerSelection(lireNumeros(r.quarte8), lireListe(r.coups_surs), arrivee);
    ajouter("Consensus (toutes IA)", e);
    coursesAvecProno.add(cle(r));
    const c = r.confiance ?? 0;
    buckets[c < 40 ? "confiance < 40" : c < 65 ? "confiance 40-64" : "confiance ≥ 65"].push(e);
  }

  const arriveeParCourse = new Map((courses.results || []).map((c) => [cle(c), lireArrivee(c.arrivee_json)]));
  const selFavoris = new Map();
  for (const r of favoris.results || []) {
    const k = cle(r);
    if (!selFavoris.has(k)) selFavoris.set(k, []);
    selFavoris.get(k).push(r.num_pmu);
  }
  const evalsFavorisMemes = [];
  const evalsFavorisTous = [];
  for (const [k, numeros] of selFavoris) {
    const arrivee = arriveeParCourse.get(k);
    if (!arrivee || !arrivee.length) continue;
    const e = evaluerSelection(numeros, [], arrivee);
    evalsFavorisTous.push(e);
    if (coursesAvecProno.has(k)) evalsFavorisMemes.push(e);
  }

  const resultat = {};
  for (const [label, evals] of Object.entries(evalsParLabel)) resultat[label] = agregerEvaluations(evals);

  const avertissements = [];
  for (const [label, r] of Object.entries(resultat)) {
    if (r.n < 30) avertissements.push(`${label} : seulement ${r.n} course(s) mesurée(s) — trop peu pour conclure (viser 100+).`);
  }
  if (!Object.keys(resultat).length) {
    avertissements.push("Aucun pronostic mesurable pour l'instant : il faut des courses pronostiquées ET archivées avec leur arrivée.");
  }

  return {
    periode: { depuis, jours },
    lecture:
      "chevaux_corrects_moy = nombre moyen de tes 8 chevaux arrivés dans les 4 premiers (max 4). " +
      "À comparer à la ligne « Référence : 8 plus petites cotes » : une IA ne vaut son coût que si elle fait mieux que le marché.",
    ia: resultat,
    reference_marche: {
      "sur les mêmes courses que les IA": agregerEvaluations(evalsFavorisMemes),
      "sur toutes les courses archivées": agregerEvaluations(evalsFavorisTous),
    },
    consensus_par_niveau_de_confiance: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, agregerEvaluations(v)])),
    avertissements,
  };
}

async function handleAdminPerformanceIA(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  if (!env.DB) return new Response(JSON.stringify({ error: "Base D1 indisponible" }), { status: 503, headers: corsHeaders });
  try {
    const jours = Math.max(1, Math.min(365, parseInt(new URL(request.url).searchParams.get("jours"), 10) || 60));
    return new Response(JSON.stringify(await calculerPerformanceIA(env, jours)), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}

async function loadResultatsDuJour(env) {
  const date = todayParam();
  const programme = await fetchJSON(`${PMU_BASE}/programme/${date}`);
  const reunions = programme.programme?.reunions || [];

  const resultats = [];
  for (const reunion of reunions) {
    const numReunion = reunion.numOfficiel ?? reunion.numExterne;
    const hippodrome = reunion.hippodrome?.libelleCourt || reunion.libelleCourt || "";

    for (const course of reunion.courses || []) {
      const numCourse = course.numOrdre ?? course.numExterne;
      const podium = await getArrivee(date, numReunion, numCourse);
      if (!podium) continue;

      const reunionCode = `R${numReunion}`;
      const courseCode = `C${numCourse}`;

      const statutQuarte = await verifierPrediction(env, date, reunionCode, courseCode, podium);

      resultats.push({
        reunion: reunionCode,
        course: courseCode,
        hippodrome,
        heure: formatHeure(course.heureDepart),
        podium,
        // null = pas de pronostic enregistré pour cette course (pas de badge) ;
        // true/false = pronostic vérifié, réussi ou non.
        quarteReussi: statutQuarte?.quarteReussi ?? null,
        tierceReussi: statutQuarte?.tierceReussi ?? null,
      });
    }
  }
  // Les plus récentes en premier
  return resultats.reverse();
}

async function handleResultatsDuJour(env) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
  const cached = await env.CACHE_KV.get(RESULTATS_CACHE_KEY, { type: "json" });
  const now = Date.now();

  if (cached && now - cached.fetchedAt < RESULTATS_TTL_MS) {
    return new Response(
      JSON.stringify({ source: "cache", updatedAt: cached.fetchedAt, resultats: cached.resultats }),
      { headers: corsHeaders }
    );
  }

  try {
    const resultats = await loadResultatsDuJour(env);
    const payload = { resultats, fetchedAt: now };
    await env.CACHE_KV.put(RESULTATS_CACHE_KEY, JSON.stringify(payload), { expirationTtl: 180 });
    return new Response(
      JSON.stringify({ source: "live", updatedAt: now, resultats }),
      { headers: corsHeaders }
    );
  } catch (e) {
    if (cached) {
      return new Response(
        JSON.stringify({
          source: "stale-cache",
          updatedAt: cached.fetchedAt,
          resultats: cached.resultats,
          warning: e.message,
        }),
        { headers: corsHeaders }
      );
    }
    return new Response(
      JSON.stringify({ error: "Impossible de récupérer les résultats PMU", details: e.message }),
      { status: 502, headers: corsHeaders }
    );
  }
}

function formatHeure(heureDepart) {
  try {
    return new Date(heureDepart).toISOString().slice(11, 16);
  } catch {
    return "";
  }
}

// Récupère hippodrome/discipline/distance pour une course donnée, en réutilisant
// le même parsing que loadCoursesDuJour (déjà éprouvé en production).
async function getCourseInfo(date, numReunion, numCourse) {
  try {
    const programme = await fetchJSON(`${PMU_BASE}/programme/${date}`);
    const reunions = programme.programme?.reunions || [];
    const reunion = reunions.find((r) => `R${r.numOfficiel ?? r.numExterne}` === numReunion);
    if (!reunion) return {};
    const course = (reunion.courses || []).find(
      (c) => `C${c.numOrdre ?? c.numExterne}` === numCourse
    );
    const meteo = reunion.meteo || {};
    const montant = course?.montantPrix ?? course?.montantTotalOffert ?? null;
    return {
      hippodrome: reunion.hippodrome?.libelleCourt || reunion.libelleCourt || "",
      discipline: course?.discipline || course?.specialite || "",
      distance: course?.distance || null,
      // Champs additionnels — récupérés si l'API PMU les fournit pour cette course,
      // sinon restent vides et sont simplement omis du prompt.
      categorieParticularite: course?.categorieParticularite || "",
      conditions: course?.conditions || "",
      parcours: course?.parcours || "",
      corde: course?.corde || "",
      montantPrix: montant,
      meteo: {
        temperature: meteo.temperature ?? null,
        nebulosite: meteo.nebulositeLibelleCourt || meteo.nebulositeLibelleLong || "",
        vent: meteo.forceVent != null ? `${meteo.forceVent} km/h ${meteo.directionVent || ""}`.trim() : "",
      },
      heureDepart: course?.heureDepart ? formatHeure(course.heureDepart) : "",
    };
  } catch {
    return {};
  }
}

// --- Pronostics IA (3 modèles combinés) — Quarté en 8 chevaux + 2 coups sûrs ---

// Réduit un nombre entier à un chiffre unique (1-9) par addition successive des chiffres.
function reduireChiffre(n) {
  n = Math.abs(Math.trunc(n));
  while (n > 9) {
    n = String(n)
      .split("")
      .reduce((s, d) => s + Number(d), 0);
  }
  return n;
}

// Valeur numérologique d'un nom (A=1..Z=26, réduite à 1-9).
function valeurNomNumerologie(nom) {
  const lettres = (nom || "").toUpperCase().replace(/[^A-ZÀ-Ý]/g, "");
  const map = { À: "A", Â: "A", Ä: "A", É: "E", È: "E", Ê: "E", Ë: "E", Î: "I", Ï: "I", Ô: "O", Ö: "O", Ù: "U", Û: "U", Ü: "U", Ç: "C", Ý: "Y" };
  let total = 0;
  for (const l of lettres) {
    const base = map[l] || l;
    const code = base.charCodeAt(0) - 64; // A=1..Z=26
    if (code >= 1 && code <= 26) total += code;
  }
  return total ? reduireChiffre(total) : 0;
}

// Chiffre du jour = jour + mois + année de la course, réduit à un chiffre unique.
function chiffreDuJour(dateStr) {
  // dateStr attendu au format PMU (ex: DDMMYYYY ou YYYY-MM-DD selon l'appelant).
  const digits = String(dateStr).replace(/\D/g, "");
  if (!digits) return null;
  const total = digits.split("").reduce((s, d) => s + Number(d), 0);
  return reduireChiffre(total);
}

// Endpoint PMU "performances-detaillees" : donne, pour chaque partant, ses
// dernières courses courues avec hippodrome, niveau (allocation), nombre de
// partants, discipline, distance et — pour le trot — sa réduction
// kilométrique (temps au km, mesure de vitesse directement comparable d'une
// course à l'autre malgré des distances différentes). Bien plus riche et
// vérifiable que la simple chaîne "musique" utilisée jusqu'ici.
async function fetchPerformancesDetaillees(date, reunion, course) {
  try {
    const data = await fetchJSON(
      `${PMU_BASE}/programme/${date}/${reunion}/${course}/performances-detaillees`
    );
    const map = {};
    for (const p of data.participants || []) {
      if (p.numPmu != null) map[p.numPmu] = p;
    }
    return map;
  } catch {
    return {};
  }
}

// Résume les 3 dernières courses d'un cheval à partir de
// "performances-détaillées" : niveau de la course (allocation, nb partants),
// place réellement obtenue, et pour le trot sa réduction kilométrique
// (plus bas = plus rapide).
function resumerFormeRecente(perf, disciplineCourse) {
  if (!perf || !Array.isArray(perf.coursesCourues) || perf.coursesCourues.length === 0) return null;
  const estTrot = /TROT|ATTELE|MONTE/i.test(disciplineCourse || perf.coursesCourues[0]?.discipline || "");
  const lignes = perf.coursesCourues.slice(0, 3).map((c) => {
    const soi = (c.participants || []).find((p) => p.itsHim);
    let placeTxt = "place inconnue";
    if (soi?.place?.place) placeTxt = `${soi.place.place}e`;
    else if (soi?.place?.statusArrivee && soi.place.statusArrivee !== "PLACE") {
      placeTxt = soi.place.statusArrivee.toLowerCase().replace(/_/g, " ");
    }
    const vitesse = estTrot && soi?.reductionKilometrique ? `, ${(soi.reductionKilometrique / 100).toFixed(2)}s/km` : "";
    const dateStr = c.date ? new Date(c.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "?";
    const niveau = c.allocation ? `${Math.round(c.allocation)}€` : "";
    return `${dateStr} ${c.hippodrome || "?"} (${c.nbParticipants || "?"}p${niveau ? ", " + niveau : ""}) : ${placeTxt}${vitesse}`;
  });
  return lignes.join(" | ");
}

// Classe la discipline brute renvoyée par l'API PMU en 3 grandes familles,
// car le poids relatif de chaque critère diffère réellement entre elles
// (ex. le poids porté compte beaucoup en plat/handicap mais quasi pas en
// trot attelé ; la fiabilité au départ du driver est cruciale en trot mais
// sans équivalent en plat).
function classifierDiscipline(discipline, categorieParticularite) {
  const texte = `${discipline || ""} ${categorieParticularite || ""}`.toUpperCase();
  if (/OBSTACLE|HAIE|STEEPLE|CROSS/.test(texte)) return "OBSTACLE";
  if (/TROT|ATTELE|MONTE/.test(texte)) return "TROT";
  if (/PLAT/.test(texte)) return "PLAT";
  return "INCONNUE";
}

// Pondérations propres à chaque discipline. Ce sont des points de départ
// raisonnés (pas une vérité statistique établie) — à ajuster avec le temps
// grâce au suivi réel des résultats (table resultats_verifies).
const PONDERATIONS = {
  PLAT: {
    label: "PLAT",
    focus: "focus sur la pointe de vitesse, la position à la corde et le poids porté (handicaps).",
    grille:
      "Forme récente (musique des 5 dernières courses) : 35% | Poids porté (handicap) : 20% | Position à la corde : 15% | Jockey et entraîneur (taux de réussite) : 15% | Aptitude à la piste/distance : 10% | Valeur (cote vs niveau réel) : 5%",
  },
  TROT: {
    label: "TROT (attelé/monté)",
    focus: "focus sur le déferrage, les allures et surtout la fiabilité du driver au départ (un cheval disqualifié ou dégagé perd toute chance, quelle que soit sa forme).",
    grille:
      "Forme récente (musique des 5 dernières courses) : 40% | Jockey/driver et fiabilité au départ (taux de réussite) : 25% | Position au départ (corde/autostart) : 15% | Aptitude à la piste/distance : 10% | Poids porté (monté uniquement) : 5% | Valeur (cote vs niveau réel) : 5%",
  },
  OBSTACLE: {
    label: "OBSTACLE (haies, steeple-chase)",
    focus: "focus sur l'aptitude aux sauts et l'endurance ; repère dans la musique les lettres indiquant chute/tombé récent (\"t\", \"Tb\") et pénalise fortement.",
    grille:
      "Forme récente ET aptitude aux sauts (pénaliser chute/tombé récent) : 35% | Aptitude à la distance/endurance : 20% | Jockey (expérience obstacle) : 20% | Poids porté : 15% | Position à la corde : 5% | Valeur (cote vs niveau réel) : 5%",
  },
  INCONNUE: {
    label: "discipline non identifiée avec certitude",
    focus: "reste prudent : sans certitude sur la discipline exacte, applique une pondération équilibrée plutôt que de sur-pondérer un critère spécifique à une discipline.",
    grille:
      "Forme récente (musique des 5 dernières courses) : 35% | Jockey/driver et entraîneur (taux de réussite) : 20% | Position à la corde : 15% | Poids porté : 10% | Aptitude à la piste/discipline/distance : 15% | Valeur (cote vs niveau réel) : 5%",
  },
};

function buildPrompt(participants, courseInfo, date, performancesParNumero = {}, reunion = "", course = "") {
  const chiffreJour = chiffreDuJour(date);
  const liste = participants
    .filter((p) => !p.nonPartant)
    .map((p) => {
      const cote = p.dernierRapportDirect?.rapport;
      const jockey = p.driver?.nom || p.entraineur?.nom || "inconnu";
      const musique = p.musique || "non renseignée";
      const age = p.age != null ? `${p.age} ans` : "âge inconnu";
      const sexe = p.sexe || "";
      const corde = p.placeCorde != null ? `corde ${p.placeCorde}` : "corde inconnue";
      const poids = p.handicapPoids != null ? `poids ${p.handicapPoids}kg` : "";
      const oeilleres = p.oeilleres && p.oeilleres !== "SANS_OEILLERES" ? `œillères: ${p.oeilleres}` : "";
      const gainsCarriere = p.gainsParticipant?.gainsCarriere;
      const gains = gainsCarriere != null ? `gains carrière: ${Math.round(gainsCarriere / 100)}€` : "";
      const chiffreNum = reduireChiffre(p.numPmu || 0);
      const chiffreNom = valeurNomNumerologie(p.nom);
      const numero = `numéro réduit: ${chiffreNum}, nom réduit: ${chiffreNom}`;
      const details = [sexe, age, corde, poids, oeilleres, gains, numero].filter(Boolean).join(", ");
      const formeDetaillee = resumerFormeRecente(performancesParNumero[p.numPmu], courseInfo.discipline);
      return `N°${p.numPmu} ${p.nom} — jockey/driver ${jockey} — cote ${cote ?? "non cotée"} — musique: ${musique}${details ? " — " + details : ""}${formeDetaillee ? `\n   → historique détaillé (3 dernières courses, source officielle PMU) : ${formeDetaillee}` : ""}`;
    })
    .join("\n");

  const dateAffichee = date && String(date).length === 8 ? `${String(date).slice(0, 2)}/${String(date).slice(2, 4)}/${String(date).slice(4)}` : String(date || "");
  const hippodrome = courseInfo.hippodrome || "hippodrome inconnu";
  const contexte = [
    `Discipline (fournie par le PMU) : ${courseInfo.discipline || "inconnue"}`,
    `Hippodrome : ${hippodrome}`,
    `Distance : ${courseInfo.distance ? courseInfo.distance + " m" : "inconnue"}`,
    courseInfo.heureDepart ? `Heure de départ : ${courseInfo.heureDepart}` : "",
    courseInfo.categorieParticularite ? `Type d'épreuve : ${courseInfo.categorieParticularite}` : "",
    courseInfo.montantPrix ? `Allocation : ${Math.round(courseInfo.montantPrix / 100)} €` : "",
    courseInfo.parcours ? `Parcours/corde : ${courseInfo.parcours}` : courseInfo.corde ? `Corde : ${courseInfo.corde}` : "",
    courseInfo.conditions ? `Conditions de la course : ${courseInfo.conditions}` : "",
    courseInfo.meteo && (courseInfo.meteo.temperature != null || courseInfo.meteo.nebulosite || courseInfo.meteo.vent)
      ? `Météo : ${[courseInfo.meteo.temperature != null ? courseInfo.meteo.temperature + "°C" : "", courseInfo.meteo.nebulosite, courseInfo.meteo.vent].filter(Boolean).join(", ")}`
      : "",
  ].filter(Boolean).join("\n");

  // Le texte ci-dessous (jusqu'à « …pour me permettre de jouer ou pas ») est le prompt de l'exploitant, repris tel quel.
  // Seuls les éléments entre ${…} sont renseignés automatiquement. Les blocs « DONNÉES » et « FORMAT DE RÉPONSE »
  // qui suivent sont techniques : données officielles de la course et sortie lisible par le site.
  return `Tu es un expert turf spécialisé sur les pistes hippiques françaises, adaptable à toutes les réunions (ParisTurf, PMU, etc.), couvrant les courses de plat, de trot (attelé ou monté) et d'obstacles (haies, steeple-chase).

Pour la course ${reunion} ${course} à ${hippodrome} du ${dateAffichee}, effectue les étapes suivantes de manière structurée et approfondie, en adaptant les facteurs à la discipline (plat : vitesse et positions ; trot : déferrage, drivers et allures ; obstacles : aptitude aux sauts et endurance) :

Analyse Globale et Approfondie : Décris le contexte : type d'épreuve (handicap, claiming, Groupe, etc.), discipline (plat, trot attelé/monté, haies/steeple), distance, surface (herbe, PSF, sable, etc.), corde (gauche/droite), conditions météo prévues, prize money, heure de départ. Analyse les facteurs clés : forme récente (musiques des 5 dernières courses), aptitude à la piste/surface/discipline, positions à la corde (avantage intérieur/extérieur), jockeys/drivers (taux de réussite), entraîneurs (spécialistes), poids/âge, équipements (œillères, déferrage pour trot, etc.), historique sur le parcours. Pour trot : focus sur allures et départs ; pour obstacles : sauts et terrain lourd ; pour plat : pointe de vitesse. Synthétise les pronostics externes (Turfoo, PMU, Zeturf) et cotes approximatives. Identifie favoris, outsiders dangereux, et chevaux à écarter.

Sélection Expert Personnelle en 8 Numéros Très Fiable : Applique une pondération : 40% forme récente, 20% jockey/driver/entraîneur, 15% corde, 10% poids, 10% aptitude piste/discipline, 5% cotes/valeur. Fournis la sélection en 8 numéros, avec explications brèves par cheval. Conseils de jeu : quinté+, couplé, etc.

Validation avec Filtre Numérologique : Calcule le chiffre du jour (jour + mois + année réduite à un chiffre unique). Pour chaque cheval de la sélection : réduit le numéro à un chiffre, et la valeur numérologique du nom (A=1, B=2... Z=26, réduit à 1-9). Vérifie compatibilité avec le chiffre du jour (favorise harmonie : ex. 1-9 compatibles spécifiques comme équilibre pour 2). Confirme ou ajuste légèrement la sélection si conflits majeur

Enfin donne ton indice de confiance desormais pour chaque course sur une echelle de 1 a 100% pour me permettre de jouer ou pas

=== DONNÉES OFFICIELLES DE LA COURSE (source PMU) ===
${contexte}

Partants (musique = performances récentes, la plus récente en premier ; ex. "1a2a3a" = 1er, 2e, 3e). Quand un "historique détaillé" est fourni, c'est une donnée officielle : base-toi dessus en priorité pour juger la forme réelle. Au trot, la réduction kilométrique (plus bas = plus rapide) compare objectivement les chevaux.
${liste}

Chiffre du jour déjà calculé pour cette course : ${chiffreJour ?? "inconnu"} (le "numéro réduit" et le "nom réduit" de chaque cheval sont donnés ci-dessus : tu peux t'en servir directement pour le filtre numérologique, qui reste un ajustement à la marge et ne doit jamais l'emporter sur la pondération).

=== FORMAT DE RÉPONSE (obligatoire : ta réponse est lue par un programme) ===
Fais toute ton analyse, ta pondération et ton filtre numérologique en interne : ne rédige PAS l'analyse globale. Si tu disposes d'une recherche web, utilise-la pour les pronostics externes ; sinon n'invente jamais un pronostic externe, appuie-toi uniquement sur les données ci-dessus.
Réponds UNIQUEMENT avec un objet JSON strict, sans texte ni markdown autour, exactement sous cette forme :
{"quarte8": [{"numero": N, "cheval": "Nom", "explication": "1 phrase courte (140 caractères max) justifiant ce choix"}, … 8 chevaux, du plus probable au moins probable pour une place dans les 4 premiers …], "coupsSurs": [n1, n2], "confiance": <entier de 1 à 100>, "conseilsJeu": "1 à 2 phrases : quelle combinaison jouer (quinté+, couplé, etc.) ou pourquoi s'abstenir"}
- "coupsSurs" : 2 numéros parmi les 8, ceux qui cumulent la majorité des critères favorables (pas seulement la cote la plus basse).
- "confiance" : ton indice pour décider de jouer ou non. Il doit refléter la CONCORDANCE entre forme, cote et jockey/driver : signaux qui convergent clairement = élevé ; signaux contradictoires ou peloton très homogène = bas. Ne le gonfle pas parce que la cote du favori est basse.`;
}

function parseQuarteJSON(text) {
  try {
    let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    // Si le modèle a ajouté du texte avant/après le JSON malgré la consigne,
    // on isole le premier bloc { ... } complet plutôt que d'échouer direct.
    if (cleaned[0] !== "{") {
      const start = cleaned.indexOf("{");
      const end = cleaned.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        cleaned = cleaned.slice(start, end + 1);
      }
    }
    const obj = JSON.parse(cleaned);
    if (obj && Array.isArray(obj.quarte8) && obj.quarte8.length >= 4 && obj.confiance != null) {
      return {
        quarte8: obj.quarte8.slice(0, 8).map((c) => ({
          numero: c.numero,
          cheval: String(c.cheval),
          explication: typeof c.explication === "string" ? c.explication.trim().slice(0, 220) : "",
        })),
        coupsSurs: Array.isArray(obj.coupsSurs) ? obj.coupsSurs.slice(0, 2) : [],
        confiance: Math.max(0, Math.min(100, Math.round(obj.confiance))),
        conseilsJeu: typeof obj.conseilsJeu === "string" ? obj.conseilsJeu.trim().slice(0, 400) : "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function callGemini(prompt, apiKey) {
  if (!apiKey) throw new Error("Clé API manquante");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini a répondu ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseQuarteJSON(text);
  if (!parsed) throw new Error("Réponse Gemini non conforme (JSON illisible)");
  return { ...parsed, source: "Gemini" };
}

async function callGroq(prompt, apiKey) {
  if (!apiKey) throw new Error("Clé API manquante");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq a répondu ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const parsed = parseQuarteJSON(text);
  if (!parsed) throw new Error("Réponse Groq non conforme (JSON illisible)");
  return { ...parsed, source: "Groq" };
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Modèle DeepSeek utilisé pour les pronostics.
//  - "deepseek-v4-pro"   = celui du mode « Expert » de l'application DeepSeek
//                         (1,6 T de paramètres) — réponses plus fines, environ 10x plus cher ;
//  - "deepseek-v4-flash" = celui du mode « Instant » (284 Md de paramètres) — plus léger.
// Pour revenir au modèle léger, il suffit de remplacer par "deepseek-v4-flash".
const DEEPSEEK_MODELE = "deepseek-v4-pro";
// Effort de raisonnement : low / high / max. "max" est le plus poussé mais aussi le plus lent
// (risque de dépasser le délai puis de basculer sur le repli) ; "high" est un bon compromis.
const DEEPSEEK_EFFORT = "high";
const DEEPSEEK_DELAI_S = 70;

async function callDeepSeekUneFois(prompt, apiKey) {
  if (!apiKey) throw new Error("Clé API manquante");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEEPSEEK_DELAI_S * 1000);
  const debut = Date.now();
  let res;
  try {
    res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // "deepseek-reasoner" est un nom retiré par DeepSeek le 24/07/2026 : il
        // faut désormais nommer explicitement le modèle (deepseek-v4-flash) et
        // piloter le raisonnement via "thinking" + "reasoning_effort" plutôt
        // que via le nom du modèle. effort "max" = raisonnement le plus
        // poussé disponible (choix volontaire : ce sont des pronostics, la
        // qualité prime sur la vitesse ici). Note : "medium" n'existe pas
        // vraiment côté DeepSeek, il est automatiquement ramené à "high" —
        // les seuls vrais paliers sont low / high / max.
        // Note : le mode thinking ignore temperature/top_p, donc on ne les
        // envoie pas. max_tokens ne couvre QUE la réponse finale (après le
        // raisonnement), qui reste minuscule ici (petit objet JSON).
        model: DEEPSEEK_MODELE,
        thinking: { type: "enabled" },
        reasoning_effort: DEEPSEEK_EFFORT,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
        max_tokens: 8000,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`DeepSeek n'a pas répondu à temps (délai de ${DEEPSEEK_DELAI_S}s dépassé)`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`DeepSeek a répondu ${res.status}: ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const parsed = parseQuarteJSON(text);
  if (!parsed) {
    throw new Error(
      `Réponse DeepSeek non conforme (JSON illisible) — finish_reason: ${data.choices?.[0]?.finish_reason || "?"}, longueur contenu: ${text.length}`
    );
  }
  console.log(`[deepseek] ${DEEPSEEK_MODELE} (effort ${DEEPSEEK_EFFORT}) — réponse en ${Math.round((Date.now() - debut) / 1000)}s`);
  return { ...parsed, source: "DeepSeek", modele: DEEPSEEK_MODELE, web: 0 };
}

// DeepSeek (modèle "reasoner", plus lent et plus facilement saturé en cas
// d'appels simultanés nombreux) renvoie parfois une erreur 429 (trop de
// requêtes) ou 5xx transitoire quand plusieurs courses sont analysées en
// même temps, ou dépasse carrément le délai imparti sur les courses à
// beaucoup de partants (raisonnement plus long). Un unique échec silencieux
// plante tout l'affichage (course du jour) puisque c'est désormais
// la seule IA active, d'où le repli sur "deepseek-chat" (même fournisseur,
// sans raisonnement donc beaucoup plus rapide et fiable).
//
// Important pour la latence : un timeout (55s) n'est PAS retenté — retenter
// un raisonnement qui a déjà pris 55s a très peu de chances d'aboutir plus
// vite, et ça double inutilement l'attente (jusqu'à ~110s) avant même
// d'atteindre le repli rapide. On ne retente que les erreurs transitoires
// rapides (429 / 5xx), qui échouent en général en quelques secondes, donc
// le retry n'y coûte presque rien.
async function callDeepSeek(prompt, apiKey) {
  try {
    return await callDeepSeekUneFois(prompt, apiKey);
  } catch (e1) {
    const isTimeout = /délai de \d+s/.test(e1.message || "");
    const retryableRapide = !isTimeout && (e1.status === 429 || e1.status >= 500);
    if (!retryableRapide) return await callDeepSeekChatRepli(prompt, apiKey, e1);
    await pause(2000 + Math.random() * 2000);
    try {
      return await callDeepSeekUneFois(prompt, apiKey);
    } catch (e2) {
      return await callDeepSeekChatRepli(prompt, apiKey, e2);
    }
  }
}

// Repli utilisé quand deepseek-reasoner a échoué (timeout ou erreur) : le
// modèle "chat" standard suit le même prompt mais sans étape de
// raisonnement, donc répond en quelques secondes au lieu de pouvoir dépasser
// 55s. Si ce repli échoue aussi, on relance l'erreur d'origine (plus
// parlante pour le statut IA affiché en admin) plutôt que celle du repli.
async function callDeepSeekChatRepli(prompt, apiKey, erreurOrigine) {
  if (!apiKey) throw erreurOrigine || new Error("Clé API manquante");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  let res;
  try {
    res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // "deepseek-chat" est également un nom retiré (24/07/2026) : c'est
        // désormais deepseek-v4-flash avec thinking désactivé.
        model: "deepseek-v4-flash",
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
      }),
      signal: controller.signal,
    });
  } catch {
    throw erreurOrigine;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) throw erreurOrigine;
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const parsed = parseQuarteJSON(text);
  if (!parsed) throw erreurOrigine;
  console.warn(`[deepseek] REPLI sur deepseek-v4-flash (sans raisonnement) car ${DEEPSEEK_MODELE} a échoué : ${(erreurOrigine && erreurOrigine.message) || erreurOrigine}`);
  return { ...parsed, source: "DeepSeek", modele: "deepseek-v4-flash", web: 0 };
}

async function callClaude(prompt, apiKey) {
  if (!apiKey) throw new Error("Clé API manquante");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 2500,
      system:
        "Tu réponds STRICTEMENT avec l'objet JSON demandé par l'utilisateur, sans aucun texte, explication, raisonnement visible ou balise markdown avant ou après. La toute première caractère de ta réponse doit être { et le tout dernier doit être }. Aucune phrase d'introduction ni de conclusion.",
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude a répondu ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.find((b) => b.type === "text")?.text || "";
  const parsed = parseQuarteJSON(text);
  if (!parsed) throw new Error("Réponse Claude non conforme (JSON illisible)");
  return { ...parsed, source: "Claude" };
}

// GPT-6 Sol (OpenAI, 2 $ / 10 $ par M tokens) — API « Responses ». Clé à définir : OPENAI_API_KEY (wrangler secret put OPENAI_API_KEY).
// Sans clé, l'appel échoue proprement (Promise.allSettled) et les autres IA continuent seules.
const GPT_SOL_MODELE = "gpt-6-sol";
const GPT_SOL_EFFORT = "high"; // none | low | medium | high | xhigh | max — plus haut = plus lent et plus cher
const GPT_SOL_DELAI_S = 120; // la recherche web + le raisonnement « high » allongent la réponse
// Recherche web native OpenAI (outil « web_search » de l'API Responses) : facturée à l'appel EN PLUS des
// tokens. Mettre false pour la désactiver (retour au comportement sans internet).
const GPT_SOL_RECHERCHE_WEB = true;

async function callGPTSol(prompt, apiKey, contexte = {}) {
  if (!apiKey) throw new Error("Clé OpenAI manquante (OPENAI_API_KEY)");
  const dateAffichee = contexte.date ? `${String(contexte.date).slice(0, 2)}/${String(contexte.date).slice(2, 4)}/${String(contexte.date).slice(4)}` : "";
  const contexteWeb = [contexte.reunion && contexte.course ? `${contexte.reunion} ${contexte.course}` : "", contexte.hippodrome, dateAffichee]
    .filter(Boolean)
    .join(", ");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GPT_SOL_DELAI_S * 1000);
  const debut = Date.now();
  let res;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: GPT_SOL_MODELE,
        instructions:
          "Tu réponds STRICTEMENT avec l'objet JSON demandé, sans texte, explication ni balise markdown avant ou après. Le premier caractère de ta réponse doit être { et le dernier }." +
          (GPT_SOL_RECHERCHE_WEB
            ? ` Tu disposes d'une recherche web : avant de répondre, cherche les pronostics et analyses publiés pour cette course${contexteWeb ? ` (${contexteWeb})` : ""} sur Turfoo, PMU, Zeturf et ParisTurf, ainsi que les informations de dernière minute (non-partants, terrain, déferrage, changements de driver). Utilise-les comme éléments de validation et de recoupement : la pondération du prompt reste prioritaire. N'invente jamais un pronostic ou une information que tu n'as pas réellement trouvé. Aucune citation ni lien dans ta réponse : uniquement le JSON.`
            : ""),
        input: prompt,
        ...(GPT_SOL_RECHERCHE_WEB ? { tools: [{ type: "web_search", search_context_size: "low" }] } : {}),
        reasoning: { effort: GPT_SOL_EFFORT },
        max_output_tokens: 16000, // le raisonnement « high » consomme aussi ce budget
      }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`GPT Sol n'a pas répondu à temps (délai de ${GPT_SOL_DELAI_S}s dépassé)`);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`GPT Sol a répondu ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  // Format brut de l'API Responses : output[] contient des blocs "reasoning" puis un bloc "message"
  // dont content[] porte les "output_text".
  const text =
    data.output_text ||
    (data.output || [])
      .filter((o) => o.type === "message")
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("");
  const parsed = parseQuarteJSON(text || "");
  if (!parsed) {
    throw new Error(`Réponse GPT Sol non conforme (JSON illisible) — status: ${data.status || "?"}, longueur: ${(text || "").length}`);
  }
  const nbRecherches = (data.output || []).filter((o) => o.type === "web_search_call").length;
  console.log(`[gpt-sol] ${GPT_SOL_MODELE} (effort ${GPT_SOL_EFFORT}, ${nbRecherches} recherche(s) web) — réponse en ${Math.round((Date.now() - debut) / 1000)}s`);
  return { ...parsed, source: "GPT Sol", modele: GPT_SOL_MODELE, web: GPT_SOL_RECHERCHE_WEB ? 1 : 0 };
}

// --- Chat IA (question libre sur les courses du jour) ---
// Réutilise Groq/DeepSeek en mode texte libre (pas de JSON structuré ici).

async function callGroqTexte(prompt, apiKey) {
  if (!apiKey) throw new Error("Clé Groq manquante");
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 400,
    }),
  });
  if (!res.ok) throw new Error(`Groq a répondu ${res.status}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function callDeepSeekTexte(prompt, apiKey) {
  if (!apiKey) throw new Error("Clé DeepSeek manquante");
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      // "deepseek-chat" retiré (24/07/2026) → deepseek-v4-flash, thinking désactivé.
      model: "deepseek-v4-flash",
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 400,
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek a répondu ${res.status}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function callClaudeTexte(prompt, apiKey) {
  if (!apiKey) throw new Error("Clé Claude manquante");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude a répondu ${res.status}: ${detail.slice(0, 150)}`);
  }
  const data = await res.json();
  const text = data.content?.find((b) => b.type === "text")?.text || "";
  return text.trim();
}

const CHAT_LIMITE_PAR_JOUR = 15;

// Limite simple par IP+jour, stockée dans le même KV que le reste du cache.
// Empêche un abus qui ferait exploser la facture des API IA.
async function verifierLimiteChat(env, ip) {
  const date = todayParam();
  const key = `chat-limite:${date}:${ip}`;
  const actuel = await env.CACHE_KV.get(key);
  const n = actuel ? parseInt(actuel, 10) : 0;
  if (n >= CHAT_LIMITE_PAR_JOUR) return false;
  await env.CACHE_KV.put(key, String(n + 1), { expirationTtl: 24 * 60 * 60 });
  return true;
}

// Anti brute-force sur /api/auth/login : bloque après 5 échecs en 15 min,
// à la fois par IP (empêche de bourrer des mots de passe sur plusieurs comptes)
// et par email (empêche de cibler un seul compte depuis plusieurs IP).
const LOGIN_MAX_ECHECS = 5;
const LOGIN_FENETRE_SECONDES = 15 * 60;

async function verifierLimiteLogin(env, ip, email) {
  const [nIp, nEmail] = await Promise.all([
    env.CACHE_KV.get(`login-limite-ip:${ip}`),
    env.CACHE_KV.get(`login-limite-email:${email}`),
  ]);
  const echecsIp = nIp ? parseInt(nIp, 10) : 0;
  const echecsEmail = nEmail ? parseInt(nEmail, 10) : 0;
  return echecsIp < LOGIN_MAX_ECHECS && echecsEmail < LOGIN_MAX_ECHECS;
}

async function enregistrerEchecLogin(env, ip, email) {
  const [nIp, nEmail] = await Promise.all([
    env.CACHE_KV.get(`login-limite-ip:${ip}`),
    env.CACHE_KV.get(`login-limite-email:${email}`),
  ]);
  const echecsIp = (nIp ? parseInt(nIp, 10) : 0) + 1;
  const echecsEmail = (nEmail ? parseInt(nEmail, 10) : 0) + 1;
  await Promise.all([
    env.CACHE_KV.put(`login-limite-ip:${ip}`, String(echecsIp), { expirationTtl: LOGIN_FENETRE_SECONDES }),
    env.CACHE_KV.put(`login-limite-email:${email}`, String(echecsEmail), { expirationTtl: LOGIN_FENETRE_SECONDES }),
  ]);
}

async function reinitialiserLimiteLogin(env, ip, email) {
  await Promise.all([
    env.CACHE_KV.delete(`login-limite-ip:${ip}`),
    env.CACHE_KV.delete(`login-limite-email:${email}`),
  ]);
}

function buildPromptChat(question, courses, courseDuJour) {
  const liste = courses
    .slice(0, 40)
    .map((c) => {
      const fav = c.favori ? `favori N°${c.favori.numero} ${c.favori.nom} (cote ${c.favori.cote})` : "favori inconnu";
      return `${c.reunion} ${c.course} — ${c.hippodrome} ${c.heure || ""} — ${c.discipline || ""} ${c.distance ? c.distance + "m" : ""} — ${c.partants ?? "?"} partants — ${fav}`;
    })
    .join("\n");

  let blocCourseDuJour = "";
  if (courseDuJour && courseDuJour.quarte8) {
    const chevaux = courseDuJour.quarte8
      .map((c) => `N°${c.numero} ${c.cheval}${c.coupSur ? " (coup sûr IA)" : ""}`)
      .join(", ");
    blocCourseDuJour = `\n\nCourse du jour mise en avant (${courseDuJour.reunion} ${courseDuJour.course}, ${courseDuJour.hippodrome}) — pronostic de nos IA, confiance ${courseDuJour.confiance}% : ${chevaux}`;
  }

  return `Tu es l'assistant du site Turf Nova AI (pronostics hippiques PMU). Réponds en français, en 5 phrases maximum, uniquement à partir des données ci-dessous. Le "favori" est juste le cheval à la cote la plus basse, ce n'est pas un pronostic IA — ne le présente jamais comme tel. Si la question ne peut pas être répondue avec ces données (course non listée, info absente), dis-le clairement plutôt que d'inventer un cheval ou une cote. Ne donne jamais de conseil du type "mise tout" et rappelle brièvement, si pertinent, que les paris comportent un risque.

Courses du jour :
${liste}${blocCourseDuJour}

Question : "${question}"`;
}

async function handleChatIA(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  const email = await getSessionUser(request, env);
  if (!email) {
    return new Response(
      JSON.stringify({ error: "auth_required", message: "Crée un compte gratuit pour poser une question à l'IA." }),
      { status: 401, headers: corsHeaders }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }

  const question = String(body.question || "").trim();
  if (!question) {
    return new Response(JSON.stringify({ error: "Question vide" }), { status: 400, headers: corsHeaders });
  }
  if (question.length > 300) {
    return new Response(
      JSON.stringify({ error: "Question trop longue (300 caractères max)" }),
      { status: 400, headers: corsHeaders }
    );
  }

  const ip = request.headers.get("CF-Connecting-IP") || "inconnu";
  const autorise = await verifierLimiteChat(env, ip);
  if (!autorise) {
    return new Response(
      JSON.stringify({
        error: "limite_atteinte",
        message: `Limite de ${CHAT_LIMITE_PAR_JOUR} questions par jour atteinte — reviens demain.`,
      }),
      { status: 429, headers: corsHeaders }
    );
  }

  let courses = [];
  try {
    const cached = await env.CACHE_KV.get(CACHE_KEY, { type: "json" });
    courses = cached?.courses || (await loadCoursesDuJour());
  } catch {
    courses = [];
  }

  if (courses.length === 0) {
    return new Response(
      JSON.stringify({ error: "Aucune course disponible aujourd'hui pour répondre à cette question." }),
      { status: 503, headers: corsHeaders }
    );
  }

  let courseDuJour = null;
  try {
    const date = todayParam();
    const { reunion, course } = await getCourseDuJourConfig(env);
    courseDuJour = await env.CACHE_KV.get(`course-du-jour-full-v3:${date}:${reunion}:${course}`, { type: "json" });
  } catch {
    courseDuJour = null;
  }

  const prompt = buildPromptChat(question, courses, courseDuJour);

  let reponse = null;
  try {
    reponse = await callGroqTexte(prompt, env.GROQ_API_KEY);
  } catch {
    try {
      reponse = await callDeepSeekTexte(prompt, env.DEEPSEEK_API_KEY);
    } catch {
      try {
        reponse = await callClaudeTexte(prompt, env.ANTHROPIC_API_KEY);
      } catch {
        reponse = null;
      }
    }
  }

  if (!reponse) {
    return new Response(
      JSON.stringify({ error: "L'assistant IA n'a pas pu répondre, réessaie dans un instant." }),
      { status: 502, headers: corsHeaders }
    );
  }

  return new Response(JSON.stringify({ reponse }), { headers: corsHeaders });
}

// Combine les avis des IA : chaque cheval marque des points selon sa position
// dans le classement de chaque IA (8 pts pour le 1er choix, 1 pt pour le 8e).
// Les "coups sûrs" désignés par plusieurs IA remontent en tête.
// Les noms des IA (source) restent internes, jamais renvoyés au site public.
function combinerQuarte8(predictions) {
  const valid = predictions.filter(Boolean);
  if (valid.length === 0) return null;

  const scores = {};
  const coupSurVotes = {};

  for (const p of valid) {
    p.quarte8.forEach((cheval, idx) => {
      const pts = 8 - idx;
      const key = String(cheval.numero);
      if (!scores[key]) scores[key] = { numero: cheval.numero, nom: cheval.cheval, score: 0, explication: "", meilleurRang: 99 };
      scores[key].score += pts;
      // Explication retenue : celle de l'IA qui classe ce cheval le plus haut.
      if (cheval.explication && idx < scores[key].meilleurRang) {
        scores[key].explication = cheval.explication;
        scores[key].meilleurRang = idx;
      }
    });
    (p.coupsSurs || []).forEach((numero) => {
      const key = String(numero);
      coupSurVotes[key] = (coupSurVotes[key] || 0) + 1;
      if (scores[key]) scores[key].score += 3;
    });
  }

  const classement = Object.values(scores)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const coupsSurs = classement
    .map((c) => ({ ...c, votes: coupSurVotes[String(c.numero)] || 0 }))
    .sort((a, b) => b.votes - a.votes || b.score - a.score)
    .slice(0, 2)
    .map((c) => c.numero);

  const confianceMoyenne = Math.round(valid.reduce((s, p) => s + p.confiance, 0) / valid.length);
  const bonusAccord = valid.length > 1 ? (valid.length - 1) * 4 : 0;

  // Conseils de jeu : ceux de l'IA dont le top 4 recoupe le plus le classement final.
  const top4 = new Set(classement.slice(0, 4).map((c) => c.numero));
  const conseilsJeu =
    valid
      .filter((p) => p.conseilsJeu)
      .sort((a, b) => b.quarte8.slice(0, 4).filter((c) => top4.has(c.numero)).length - a.quarte8.slice(0, 4).filter((c) => top4.has(c.numero)).length)[0]?.conseilsJeu || "";

  return {
    // `conseilsJeu` est rangé sur le 1er cheval : il voyage ainsi avec le classement déjà stocké en base,
    // sans nouvelle colonne (aucune migration, aucun risque pour le verrouillage des pronostics).
    quarte8: classement.map((c, i) => ({
      position: i + 1,
      numero: c.numero,
      cheval: c.nom,
      coupSur: coupsSurs.includes(c.numero),
      ...(c.explication ? { explication: c.explication } : {}),
      ...(i === 0 && conseilsJeu ? { conseilsJeu } : {}),
    })),
    confiance: Math.min(99, confianceMoyenne + bonusAccord),
    sources: valid.map((p) => p.source), // interne uniquement — jamais exposé au client
  };
}

// Reconstruit l'objet consensus à partir d'une ligne de la table `predictions`.
function consensusDepuisLigne(row) {
  return {
    quarte8: JSON.parse(row.quarte6),
    confiance: row.confiance,
    sources: JSON.parse(row.sources || "[]"),
  };
}

async function chargerPredictionVerrouillee(env, date, reunion, course) {
  if (!env.DB) return null;
  return env.DB.prepare(
    `SELECT quarte6, coups_surs, confiance, sources, created_at FROM predictions WHERE date = ? AND reunion = ? AND course = ?`
  )
    .bind(date, reunion, course)
    .first();
}

// Calcule (ou lit en cache) le consensus IA pour une course donnée.
// Partagée entre le pronostic à la demande (handlePronosticIA) et le calcul
// du "Top courses du jour" — pour ne jamais payer deux fois l'appel aux 3 IA
// pour la même course dans la même fenêtre de cache.
//
// Une fois un pronostic généré pour une course, il est VERROUILLÉ en base
// (table `predictions`) et ne change plus jamais, même après expiration du
// cache KV (15 min) — sinon deux visiteurs consultant la même course à des
// heures différentes verraient des pronostics différents, et une prédiction
// déjà vérifiée (`resultats_verifies`) risquerait de se retrouver orpheline
// si son id était remplacé entre-temps.
async function obtenirPronosticConsensus(date, reunion, course, env) {
  const cacheKey = `pronostic:${date}:${reunion}:${course}`;
  const cached = await env.CACHE_KV.get(cacheKey, { type: "json" });
  if (cached) {
    return { consensus: cached.consensus, updatedAt: cached.updatedAt, source: "cache" };
  }

  // Cache KV expiré mais pronostic déjà verrouillé en base : on le renvoie
  // tel quel plutôt que de rappeler l'IA (aucun nouvel appel DeepSeek payant,
  // et le pronostic affiché reste identique à celui montré au tout premier
  // visiteur de la journée).
  const verrouille = await chargerPredictionVerrouillee(env, date, reunion, course);
  if (verrouille) {
    const consensus = consensusDepuisLigne(verrouille);
    await env.CACHE_KV.put(cacheKey, JSON.stringify({ consensus, updatedAt: verrouille.created_at }), { expirationTtl: 900 });
    return { consensus, updatedAt: verrouille.created_at, source: "db" };
  }

  const [data, courseInfo, performancesParNumero] = await Promise.all([
    fetchJSON(`${PMU_BASE}/programme/${date}/${reunion}/${course}/participants`),
    getCourseInfo(date, reunion, course),
    fetchPerformancesDetaillees(date, reunion, course),
  ]);
  const participants = data.participants || [];

  const prompt = buildPrompt(participants, courseInfo, date, performancesParNumero, reunion, course);

  const results = await Promise.allSettled([
    callDeepSeek(prompt, env.DEEPSEEK_API_KEY),
    callGPTSol(prompt, env.OPENAI_API_KEY, { date, reunion, course, hippodrome: courseInfo.hippodrome }),
    // Gemini, Groq et Claude désactivés — DeepSeek et GPT Sol sont utilisés pour les pronostics.
    // Réactiver en remettant les lignes ci-dessous dans le tableau si besoin :
    // callGemini(prompt, env.GEMINI_API_KEY),
    // callGroq(prompt, env.GROQ_API_KEY),
    // callClaude(prompt, env.ANTHROPIC_API_KEY),
  ]);

  // Log la vraie raison d'un échec IA — consultable avec `wrangler tail` — pour
  // pouvoir diagnostiquer sans exposer les détails techniques aux visiteurs.
  results.forEach((r) => {
    if (r.status === "rejected") {
      console.error(`[pronostic-ia] ${reunion}${course} du ${date} —`, r.reason?.message || r.reason);
    }
  });

  const predictions = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .filter(Boolean);

  const consensus = combinerQuarte8(predictions);
  if (!consensus) return { consensus: null, updatedAt: null, source: "live" };

  const updatedAt = Date.now();

  if (env.DB) {
    try {
      // OR IGNORE (et non plus OR REPLACE) : si une autre requête a verrouillé
      // cette course entre-temps (deux visiteurs cliquant en même temps), on ne
      // touche pas à la ligne déjà en place — pas de nouvel id, pas de risque
      // d'orpheliner une éventuelle vérification déjà enregistrée.
      const insertion = await env.DB.prepare(
        `INSERT OR IGNORE INTO predictions (date, reunion, course, hippodrome, quarte6, coups_surs, confiance, sources, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          date,
          reunion,
          course,
          courseInfo.hippodrome || "",
          JSON.stringify(consensus.quarte8),
          JSON.stringify(consensus.quarte8.filter((h) => h.coupSur).map((h) => h.numero)),
          consensus.confiance,
          JSON.stringify(consensus.sources),
          updatedAt
        )
        .run();

      // Mesure des IA : on garde aussi le classement PROPRE à chaque IA (et pas seulement le consensus),
      // uniquement si c'est bien cette requête qui a verrouillé la course (sinon on mélangerait deux générations).
      if (insertion?.meta?.changes === 1) {
        await enregistrerPredictionsParIA(env, date, reunion, course, predictions, updatedAt);
      }

      // On relit systématiquement ce qui est réellement stocké : en cas de
      // course concurrente ci-dessus, c'est la version de l'autre requête qui
      // a gagné et qu'il faut renvoyer/mettre en cache — pas celle qu'on vient
      // de calculer localement en pure perte.
      const stocke = await chargerPredictionVerrouillee(env, date, reunion, course);
      const consensusFinal = stocke ? consensusDepuisLigne(stocke) : consensus;
      const updatedAtFinal = stocke ? stocke.created_at : updatedAt;

      await env.CACHE_KV.put(cacheKey, JSON.stringify({ consensus: consensusFinal, updatedAt: updatedAtFinal }), { expirationTtl: 900 });
      await enregistrerFeatures(env, date, reunion, course, participants, courseInfo, consensusFinal);
      return { consensus: consensusFinal, updatedAt: updatedAtFinal, source: "live" };
    } catch (e) {
      // On n'échoue jamais la réponse à cause d'un souci d'enregistrement stats
    }
  }

  await env.CACHE_KV.put(cacheKey, JSON.stringify({ consensus, updatedAt }), { expirationTtl: 900 });
  return { consensus, updatedAt, source: "live" };
}

// Enregistre, une ligne par cheval, les données brutes utilisées pour ce pronostic.
// Best-effort : ne doit jamais faire échouer l'affichage du pronostic.
async function enregistrerFeatures(env, date, reunion, course, participants, courseInfo, consensus) {
  if (!env.DB) return;
  const coupsSurs = new Set(consensus.quarte8.filter((h) => h.coupSur).map((h) => h.numero));

  for (const p of participants.filter((p) => !p.nonPartant)) {
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO courses_features
         (date, reunion, course, num_pmu, cheval, hippodrome, discipline, distance, cote, musique, corde, poids, driver, age, sexe, oeilleres, gains_carriere, coup_sur, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          date,
          reunion,
          course,
          p.numPmu,
          p.nom || "",
          courseInfo.hippodrome || "",
          courseInfo.discipline || "",
          courseInfo.distance || null,
          p.dernierRapportDirect?.rapport ?? null,
          p.musique || "",
          p.placeCorde ?? null,
          p.handicapPoids ?? null,
          p.driver?.nom || p.entraineur?.nom || "",
          p.age ?? null,
          p.sexe || "",
          p.oeilleres || "",
          p.gainsParticipant?.gainsCarriere ?? null,
          coupsSurs.has(p.numPmu) ? 1 : 0,
          Date.now()
        )
        .run();
    } catch {
      // une ligne en échec ne doit pas bloquer les autres
    }
  }
}

// --- Quota mensuel d'analyses de courses (abonnés) ---
// Chaque abonné peut lancer au plus QUOTA_IA_PAR_MOIS analyses IA de courses « à la demande »
// (hors Course du jour) par mois civil. Seules les VRAIES générations (appel payant à l'API)
// consomment le quota : une course déjà analysée (en cache ou verrouillée en base, par ce
// visiteur ou un autre) est servie sans limite et sans rien décompter.
const QUOTA_IA_PAR_MOIS = 20;
const moisCourant = () => new Date().toISOString().slice(0, 7);
const cleQuotaIA = (email) => `quota-ia:${moisCourant()}:${String(email).toLowerCase()}`;

// Le compteur vit dans D1 : une réservation y est ATOMIQUE. Avec le seul KV (lecture puis écriture),
// un abonné qui lance 30 analyses en même temps lirait « 0 utilisée » 30 fois et passerait tout :
// 30 appels IA payants malgré une limite de 20. Si D1 est absent, on retombe sur le KV (best-effort).
let tableQuotaIAPrete = false;
async function assurerTableQuotaIA(env) {
  if (!env.DB || tableQuotaIAPrete) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS quota_ia (mois TEXT NOT NULL, email TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (mois, email))`
  ).run();
  tableQuotaIAPrete = true;
}

// Compteur hérité du KV (avant la bascule vers D1) : sert de point de départ pour ne pas offrir un compteur vierge.
async function lireQuotaIAKV(env, email) {
  const n = parseInt(await env.CACHE_KV.get(cleQuotaIA(email)), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function lireQuotaIA(env, email) {
  if (!env.DB) return lireQuotaIAKV(env, email);
  try {
    await assurerTableQuotaIA(env);
    const ligne = await env.DB.prepare(`SELECT n FROM quota_ia WHERE mois = ? AND email = ?`).bind(moisCourant(), String(email).toLowerCase()).first();
    return ligne ? ligne.n : await lireQuotaIAKV(env, email);
  } catch (e) {
    console.error("[quota-ia] lecture D1", e.message);
    return lireQuotaIAKV(env, email);
  }
}

// Réserve UNE analyse : { ok: true, utilise } si le quota le permet, { ok: false, utilise } sinon.
async function reserverQuotaIA(env, email) {
  const mail = String(email).toLowerCase();
  if (!env.DB) {
    const n = await lireQuotaIAKV(env, mail);
    if (n >= QUOTA_IA_PAR_MOIS) return { ok: false, utilise: n };
    await env.CACHE_KV.put(cleQuotaIA(mail), String(n + 1), { expirationTtl: 45 * 24 * 60 * 60 });
    return { ok: true, utilise: n + 1 };
  }
  await assurerTableQuotaIA(env);
  const mois = moisCourant();
  // Ligne créée une seule fois, avec le compteur KV éventuel comme point de départ.
  await env.DB.prepare(`INSERT OR IGNORE INTO quota_ia (mois, email, n) VALUES (?, ?, ?)`).bind(mois, mail, await lireQuotaIAKV(env, mail)).run();
  // Incrément conditionnel atomique : n'a lieu que si n < quota.
  const r = await env.DB.prepare(`UPDATE quota_ia SET n = n + 1 WHERE mois = ? AND email = ? AND n < ?`).bind(mois, mail, QUOTA_IA_PAR_MOIS).run();
  const ligne = await env.DB.prepare(`SELECT n FROM quota_ia WHERE mois = ? AND email = ?`).bind(mois, mail).first();
  return { ok: (r?.meta?.changes ?? 0) === 1, utilise: ligne ? ligne.n : QUOTA_IA_PAR_MOIS };
}

// Rend une analyse réservée mais non consommée (échec de génération, ou déjà générée par un autre).
async function rendreQuotaIA(env, email) {
  const mail = String(email).toLowerCase();
  if (!env.DB) {
    const n = await lireQuotaIAKV(env, mail);
    await env.CACHE_KV.put(cleQuotaIA(mail), String(Math.max(0, n - 1)), { expirationTtl: 45 * 24 * 60 * 60 });
    return;
  }
  await env.DB.prepare(`UPDATE quota_ia SET n = MAX(0, n - 1) WHERE mois = ? AND email = ?`).bind(moisCourant(), mail).run();
}

function etatQuotaIA(n) {
  return { utilise: Math.min(n, QUOTA_IA_PAR_MOIS), max: QUOTA_IA_PAR_MOIS, restant: Math.max(0, QUOTA_IA_PAR_MOIS - n) };
}

// L'administrateur n'est pas limité (tests, vérifications).
function estAdminEmail(env, email) {
  return !!env.ADMIN_EMAIL && String(email).toLowerCase() === String(env.ADMIN_EMAIL).trim().toLowerCase();
}

// Vrai si le pronostic de cette course existe déjà (cache KV ou verrouillé en base) :
// le servir ne coûte aucun appel à l'API.
async function pronosticDejaDisponible(date, reunion, course, env) {
  if (await env.CACHE_KV.get(`pronostic:${date}:${reunion}:${course}`)) return true;
  return !!(await chargerPredictionVerrouillee(env, date, reunion, course));
}

async function handlePronosticIA(request, env) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  const email = await getSessionUser(request, env);
  if (!email) {
    return new Response(
      JSON.stringify({ error: "auth_required", message: "Crée un compte gratuit pour voir les pronostics IA." }),
      { status: 401, headers: corsHeaders }
    );
  }

  const acces = await verifierAccesPremium(env, email);
  if (!acces.actif) {
    return new Response(
      JSON.stringify({
        error: "abonnement_requis",
        message: "Un abonnement Premium actif est nécessaire pour voir le Pronostic Premium.",
      }),
      { status: 402, headers: corsHeaders }
    );
  }

  const url = new URL(request.url);
  const reunion = url.searchParams.get("reunion");
  const course = url.searchParams.get("course");

  if (!reunion || !course) {
    return new Response(
      JSON.stringify({ error: "Paramètres 'reunion' et 'course' requis, ex: ?reunion=R1&course=C1" }),
      { status: 400, headers: corsHeaders }
    );
  }

  const date = todayParam();

  // --- Quota mensuel : on ne décompte qu'une vraie génération (course pas encore analysée) ---
  const illimite = estAdminEmail(env, email);
  let utilise = illimite ? 0 : await lireQuotaIA(env, email);
  let reserve = false;
  if (!illimite && !(await pronosticDejaDisponible(date, reunion, course, env))) {
    // Réservation ATOMIQUE de la place avant de lancer l'IA (clics simultanés = une seule place par clic).
    const reservation = await reserverQuotaIA(env, email);
    utilise = reservation.utilise;
    if (!reservation.ok) {
      return new Response(
        JSON.stringify({
          error: "quota_atteint",
          message: `Tu as utilisé tes ${QUOTA_IA_PAR_MOIS} analyses de courses de ce mois-ci. Le quota se renouvelle le 1er du mois prochain. Les courses déjà analysées restent consultables sans limite.`,
          quota: etatQuotaIA(utilise),
        }),
        { status: 429, headers: corsHeaders }
      );
    }
    reserve = true;
  }
  // On rend la place si la génération n'aboutit pas.
  const rendreLaPlace = async () => {
    if (!reserve) return;
    reserve = false;
    utilise = Math.max(0, utilise - 1);
    await rendreQuotaIA(env, email);
  };

  let resultat;
  try {
    resultat = await obtenirPronosticConsensus(date, reunion, course, env);
  } catch (e) {
    await rendreLaPlace();
    return new Response(
      JSON.stringify({ error: "Impossible de récupérer les partants", details: e.message }),
      { status: 502, headers: corsHeaders }
    );
  }

  if (!resultat.consensus) {
    await rendreLaPlace();
    return new Response(
      JSON.stringify({ error: "Aucune prédiction IA disponible" }),
      { status: 502, headers: corsHeaders }
    );
  }

  // Si un autre visiteur a généré cette course entre-temps, rien n'a été facturé à l'API pour nous.
  if (reserve && resultat.source !== "live") await rendreLaPlace();

  // Sigles publics des IA (pas les noms complets des fournisseurs).
  const SIGLES_IA = { Gemini: "GM", Groq: "GQ", DeepSeek: "DS", Claude: "CL", "GPT Sol": "GS" };
  const { sources, ...consensusPublic } = resultat.consensus;
  consensusPublic.sources = (sources || []).map((s) => SIGLES_IA[s] || s);
  return new Response(
    JSON.stringify({
      source: resultat.source,
      consensus: consensusPublic,
      updatedAt: resultat.updatedAt,
      quota: illimite ? null : etatQuotaIA(utilise),
    }),
    { headers: corsHeaders }
  );
}

// --- Comptes utilisateurs (email + mot de passe, sessions via cookie) ---

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function hashPassword(password, existingSaltHex) {
  const enc = new TextEncoder();
  const salt = existingSaltHex ? hexToBytes(existingSaltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const cookies = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

// Une session = { e: email, t: date de création }. Les anciennes sessions (simple email) restent valides,
// sauf après un changement de mot de passe : toutes les sessions antérieures sont alors coupées.
function lireSession(valeur) {
  if (!valeur) return null;
  if (valeur.startsWith("{")) {
    try {
      const o = JSON.parse(valeur);
      return o && o.e ? { email: o.e, t: o.t || 0 } : null;
    } catch {
      return null;
    }
  }
  return { email: valeur, t: 0 };
}

async function creerSession(env, email) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.CACHE_KV.put(`session:${token}`, JSON.stringify({ e: email, t: Date.now() }), { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies["session"];
  if (!token) return null;
  const session = lireSession(await env.CACHE_KV.get(`session:${token}`));
  if (!session) return null;
  const email = session.email;

  // Un compte désactivé par l'admin perd immédiatement l'accès, même avec une session valide.
  const user = await env.CACHE_KV.get(`user:${email}`, { type: "json" });
  if (user && user.actif === false) {
    await env.CACHE_KV.delete(`session:${token}`);
    return null;
  }
  // Mot de passe changé depuis la création de cette session : elle n'est plus valable.
  if (user && user.mdpChangeLe && session.t < user.mdpChangeLe) {
    await env.CACHE_KV.delete(`session:${token}`);
    return null;
  }
  return email;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function sessionCookieHeader(token) {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

function isValidEmail(email) {
  // Interdit explicitement les caractères qui n'ont rien à faire dans un email
  // (< > " ') pour empêcher toute tentative d'injection HTML via l'adresse,
  // même si l'affichage admin échappe déjà ces caractères en défense supplémentaire.
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email);
}

async function handleSignup(request, env) {

  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!isValidEmail(email)) {
    return new Response(JSON.stringify({ error: "Adresse email invalide" }), { status: 400, headers: corsHeaders });
  }
  if (password.length < 6) {
    return new Response(
      JSON.stringify({ error: "Le mot de passe doit contenir au moins 6 caractères" }),
      { status: 400, headers: corsHeaders }
    );
  }

  const existing = await env.CACHE_KV.get(`user:${email}`);
  if (existing) {
    return new Response(JSON.stringify({ error: "Un compte existe déjà avec cet email" }), { status: 409, headers: corsHeaders });
  }

  const { hash, salt } = await hashPassword(password);
  await env.CACHE_KV.put(`user:${email}`, JSON.stringify({ hash, salt, createdAt: Date.now(), actif: true }));

  // Compte gratuit dès l'inscription — plus d'essai temporisé : le pronostic du
  // jour (5 valeurs sûres, gratuit) est accessible à tout le monde sans compte payant ;
  // seul le pronostic PREMIUM (8 numéros détaillés) nécessite un abonnement.
  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO subscriptions (email, plan, status, started_at, expires_at)
         VALUES (?, 'gratuit', 'active', ?, NULL)
         ON CONFLICT(email) DO NOTHING`
      ).bind(email, Date.now()).run();
    } catch {
      // L'inscription ne doit jamais échouer à cause d'un souci sur la table subscriptions
    }
  }

  const token = await creerSession(env, email);

  if (env.RESEND_API_KEY) await envoyerEmailBienvenue(env, email);

  return new Response(JSON.stringify({ ok: true, email }), {
    status: 200,
    headers: { ...corsHeaders, "Set-Cookie": sessionCookieHeader(token) },
  });
}

async function handleLogin(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const ip = request.headers.get("CF-Connecting-IP") || "inconnue";

  const autorise = await verifierLimiteLogin(env, ip, email);
  if (!autorise) {
    return new Response(
      JSON.stringify({
        error: "trop_de_tentatives",
        message: "Trop de tentatives échouées — réessaie dans 15 minutes.",
      }),
      { status: 429, headers: corsHeaders }
    );
  }

  const stored = await env.CACHE_KV.get(`user:${email}`, { type: "json" });
  if (!stored) {
    await enregistrerEchecLogin(env, ip, email);
    return new Response(JSON.stringify({ error: "Email ou mot de passe incorrect" }), { status: 401, headers: corsHeaders });
  }

  const { hash } = await hashPassword(password, stored.salt);
  if (hash !== stored.hash) {
    await enregistrerEchecLogin(env, ip, email);
    return new Response(JSON.stringify({ error: "Email ou mot de passe incorrect" }), { status: 401, headers: corsHeaders });
  }

  if (stored.actif === false) {
    return new Response(
      JSON.stringify({ error: "Ce compte a été désactivé. Contacte le support si tu penses que c'est une erreur." }),
      { status: 403, headers: corsHeaders }
    );
  }

  await reinitialiserLimiteLogin(env, ip, email);

  const token = await creerSession(env, email);

  return new Response(JSON.stringify({ ok: true, email }), {
    status: 200,
    headers: { ...corsHeaders, "Set-Cookie": sessionCookieHeader(token) },
  });
}

// --- Mot de passe oublié : réinitialisation par lien envoyé par email (sans l'ancien mot de passe) ---
// Un mot de passe ne peut JAMAIS être changé « directement » sans preuve d'identité : n'importe qui
// pourrait alors prendre le contrôle du compte d'un abonné. Ici la preuve = accès à la boîte email du
// compte. Lien à usage unique, valable 30 min ; seul le HASH du jeton est stocké ; toutes les anciennes
// sessions sont coupées après le changement.
const RESET_TTL_SECONDS = 30 * 60;
const RESET_MAX_DEMANDES = 3;   // par email et par heure
const RESET_MAX_DEMANDES_IP = 8; // par IP et par heure

async function sha256Hex(texte) {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texte));
  return bytesToHex(new Uint8Array(bits));
}

// Compteur à fenêtre fixe (1 h) ; renvoie true si la limite est dépassée.
async function compterEtLimiter(env, cle, max) {
  const n = parseInt(await env.CACHE_KV.get(cle), 10) || 0;
  if (n >= max) return true;
  await env.CACHE_KV.put(cle, String(n + 1), { expirationTtl: 3600 });
  return false;
}

async function handleMotDePasseOublie(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return new Response(JSON.stringify({ error: "Adresse email invalide" }), { status: 400, headers: corsHeaders });
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return new Response(
      JSON.stringify({ error: "email_indisponible", message: "L'envoi d'email n'est pas disponible pour le moment. Contacte le support via WhatsApp." }),
      { status: 503, headers: corsHeaders }
    );
  }

  const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
  const limite =
    (await compterEtLimiter(env, `reset-demande-ip:${ip}`, RESET_MAX_DEMANDES_IP)) ||
    (await compterEtLimiter(env, `reset-demande-email:${email}`, RESET_MAX_DEMANDES));
  if (limite) {
    return new Response(
      JSON.stringify({ error: "trop_de_demandes", message: "Trop de demandes — réessaie dans une heure." }),
      { status: 429, headers: corsHeaders }
    );
  }

  // Réponse IDENTIQUE que le compte existe ou non (on ne révèle pas qui est inscrit).
  const reponseOk = new Response(
    JSON.stringify({ ok: true, message: "Si un compte existe avec cet email, un lien de réinitialisation vient d'être envoyé. Pense à vérifier tes spams." }),
    { headers: corsHeaders }
  );

  const user = await env.CACHE_KV.get(`user:${email}`, { type: "json" });
  if (!user || user.actif === false) return reponseOk;

  const jeton = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  await env.CACHE_KV.put(`reset:${await sha256Hex(jeton)}`, email, { expirationTtl: RESET_TTL_SECONDS });

  const base = env.SITE_DOMAIN ? `https://${env.SITE_DOMAIN}` : new URL(request.url).origin;
  const lien = `${base}/?reset=${jeton}`;
  const html = emailShell(
    "Réinitialise ton mot de passe",
    `<p style="font-size:14px; line-height:1.6;">Tu as demandé à choisir un nouveau mot de passe pour ton compte Turf Nova AI.</p>
     <a href="${lien}" style="display:inline-block; margin-top:12px; background:#c9a227; color:#0c0c0d; padding:11px 22px; border-radius:4px; text-decoration:none; font-weight:bold; font-size:13px;">Choisir un nouveau mot de passe</a>
     <p style="font-size:12.5px; line-height:1.6; margin-top:16px; opacity:.8;">Ce lien est valable 30 minutes et ne fonctionne qu'une fois. Si tu n'es pas à l'origine de cette demande, ignore simplement cet email : ton mot de passe actuel reste inchangé.</p>`
  );
  await envoyerEmail(env, { to: email, subject: "Réinitialise ton mot de passe — Turf Nova AI", html });
  return reponseOk;
}

async function handleReinitialiserMotDePasse(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }
  const jeton = String(body.token || "");
  const password = String(body.password || "");
  const lienInvalide = () =>
    new Response(
      JSON.stringify({ error: "lien_invalide", message: "Ce lien est expiré ou a déjà été utilisé. Redemande un nouveau lien." }),
      { status: 400, headers: corsHeaders }
    );

  // Frein aux essais de jetons au hasard (un jeton valide fait 64 caractères hexadécimaux).
  const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
  if (await compterEtLimiter(env, `reset-essai-ip:${ip}`, 20)) {
    return new Response(JSON.stringify({ error: "trop_de_tentatives", message: "Trop de tentatives — réessaie dans une heure." }), { status: 429, headers: corsHeaders });
  }
  if (!/^[0-9a-f]{64}$/.test(jeton)) return lienInvalide();
  if (password.length < 6) {
    return new Response(JSON.stringify({ error: "Le mot de passe doit contenir au moins 6 caractères" }), { status: 400, headers: corsHeaders });
  }

  const cle = `reset:${await sha256Hex(jeton)}`;
  const email = await env.CACHE_KV.get(cle);
  if (!email) return lienInvalide();
  const user = await env.CACHE_KV.get(`user:${email}`, { type: "json" });
  if (!user || user.actif === false) return lienInvalide();

  await env.CACHE_KV.delete(cle); // usage unique
  const { hash, salt } = await hashPassword(password);
  await env.CACHE_KV.put(`user:${email}`, JSON.stringify({ ...user, hash, salt, mdpChangeLe: Date.now() }));
  await Promise.all([
    env.CACHE_KV.delete(`login-limite-email:${email}`),
    env.CACHE_KV.delete(`reset-demande-email:${email}`),
  ]);

  // L'utilisateur est directement connecté (nouvelle session ; toutes les anciennes sont coupées).
  const token = await creerSession(env, email);
  return new Response(JSON.stringify({ ok: true, email, admin: estAdminEmail(env, email) }), {
    headers: { ...corsHeaders, "Set-Cookie": sessionCookieHeader(token) },
  });
}

async function handleLogout(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const cookies = parseCookies(request);
  const token = cookies["session"];
  if (token) await env.CACHE_KV.delete(`session:${token}`);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Set-Cookie": "session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" },
  });
}

async function handleMe(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const email = await getSessionUser(request, env);
  return new Response(JSON.stringify({ authenticated: !!email, email: email || null, admin: !!email && estAdminEmail(env, email) }), { headers: corsHeaders });
}

// --- Statistiques de performance réelle (basées sur les résultats vérifiés) ---

async function handleStatsPerformance(env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Base de données non configurée" }), { status: 503, headers: corsHeaders });
  }

  try {
    const global = await env.DB.prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN coups_surs_reussis >= 1 THEN 1 ELSE 0 END) as au_moins_un_coup_sur,
              SUM(CASE WHEN coups_surs_reussis = 2 THEN 1 ELSE 0 END) as deux_coups_surs,
              SUM(CASE WHEN chevaux_corrects = 4 THEN 1 ELSE 0 END) as quarte_reussi,
              SUM(CASE WHEN tierce_reussi = 1 THEN 1 ELSE 0 END) as tierce_reussi,
              AVG(chevaux_corrects) as moyenne_chevaux_corrects
       FROM resultats_verifies`
    ).first();

    const total = global?.total || 0;
    const tauxCoupSur = total > 0 ? Math.round((global.au_moins_un_coup_sur / total) * 100) : null;
    const tauxDoubleCoupSur = total > 0 ? Math.round((global.deux_coups_surs / total) * 100) : null;
    // Quarté en 8 gagné = les 4 chevaux de l'arrivée officielle font partie de nos 8 sélectionnés
    // (c'est la condition de gain réelle d'un ticket Quarté en 8 au PMU, peu importe l'ordre).
    const tauxQuarteReussi = total > 0 ? Math.round((global.quarte_reussi / total) * 100) : null;
    const nombreQuarteGagne = global?.quarte_reussi || 0;
    // Tiercé en 8 gagné = les 3 premiers de l'arrivée font partie de nos 8 sélectionnés.
    // Un quarté réussi compte toujours aussi comme tiercé réussi (sous-ensemble).
    const tauxTierceReussi = total > 0 ? Math.round((global.tierce_reussi / total) * 100) : null;
    const nombreTierceGagne = global?.tierce_reussi || 0;

    const recentes = await env.DB.prepare(
      `SELECT p.date, p.reunion, p.course, p.hippodrome, r.chevaux_corrects, r.coups_surs_reussis
       FROM resultats_verifies r JOIN predictions p ON p.id = r.prediction_id
       ORDER BY r.verified_at DESC LIMIT 20`
    ).all();

    return new Response(
      JSON.stringify({
        totalCoursesVerifiees: total,
        tauxAuMoinsUnCoupSur: tauxCoupSur,
        tauxDeuxCoupsSurs: tauxDoubleCoupSur,
        tauxQuarteReussi,
        nombreQuarteGagne,
        tauxTierceReussi,
        nombreTierceGagne,
        moyenneChevauxCorrectsSur4: global?.moyenne_chevaux_corrects ? Math.round(global.moyenne_chevaux_corrects * 10) / 10 : null,
        dernieresVerifications: recentes.results || [],
      }),
      { headers: corsHeaders }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Erreur base de données", details: e.message }), { status: 500, headers: corsHeaders });
  }
}

// --- Abonnements (sans paiement réel pour l'instant — statut géré manuellement) ---

// --- Emails automatiques (Resend) ---
// EMAIL_FROM doit être une adresse sur un domaine vérifié dans Resend, ex:
// "Turf Nova AI <notifications@ton-domaine.fr>". L'envoi ne doit jamais faire
// échouer l'action principale (inscription, paiement) : toujours en best-effort.

async function envoyerEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject, html }),
    });
  } catch {
    // Best-effort : un email raté ne doit jamais casser l'inscription ou le paiement.
  }
}

// Envoi groupé (mail marketing) via l'endpoint /emails/batch de Resend : jusqu'à 100
// destinataires en un seul appel HTTP (au lieu d'un appel par personne, ce qui
// dépasserait vite la limite de sous-requêtes d'un Worker Cloudflare). Le plan
// gratuit Resend autorise 100 emails/jour et 3000/mois — au-delà, les envois en
// trop sont simplement ignorés (compteur "ignores" retourné à l'admin).
const RESEND_LIMITE_GRATUITE_PAR_JOUR = 100;

async function envoyerEmailBatch(env, { subject, html, destinataires }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return { envoyes: 0, ignores: destinataires.length, erreur: "Resend non configuré (RESEND_API_KEY / EMAIL_FROM manquants)" };
  }

  const aEnvoyer = destinataires.slice(0, RESEND_LIMITE_GRATUITE_PAR_JOUR);
  const ignores = destinataires.length - aEnvoyer.length;
  let envoyes = 0;

  // L'API batch de Resend accepte jusqu'à 100 emails par appel — un seul appel suffit ici.
  for (let i = 0; i < aEnvoyer.length; i += 100) {
    const lot = aEnvoyer.slice(i, i + 100).map((to) => ({ from: env.EMAIL_FROM, to, subject, html }));
    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify(lot),
      });
      if (res.ok) envoyes += lot.length;
    } catch {
      // Best-effort : on continue avec les lots suivants même si un lot échoue.
    }
  }

  return { envoyes, ignores };
}

function emailShell(titre, corps) {
  return `
    <div style="font-family:'Nunito',Arial,sans-serif; background:#0c0c0d; padding:32px 0;">
      <div style="max-width:480px; margin:0 auto; background:#1c1c1f; border:1px solid #c9a227; border-radius:8px; overflow:hidden;">
        <div style="background:#000; padding:20px 28px;">
          <span style="font-family:'Nunito',Arial,sans-serif; font-size:20px; font-weight:bold; color:#fff; letter-spacing:1px;">TURF NOVA AI<span style="color:#c9a227;">.</span></span>
        </div>
        <div style="padding:28px; color:#f3f1ea;">
          <h1 style="font-size:19px; margin:0 0 16px; color:#fff;">${titre}</h1>
          ${corps}
        </div>
      </div>
    </div>`;
}

async function envoyerEmailBienvenue(env, email) {
  const html = emailShell(
    "Bienvenue sur Turf Nova AI 🐎",
    `<p style="font-size:14px; line-height:1.6;">Ton compte est créé — tu as dès maintenant accès aux 5 valeurs sûres gratuites du jour sur la course mise en avant.</p>
     <p style="font-size:14px; line-height:1.6;">Passe à l'abonnement Premium (mensuel ou annuel) pour débloquer le Pronostic Premium (sélection détaillée, coups sûrs, analyse complète) sur la course du jour.</p>
     <a href="https://${env.SITE_DOMAIN || "turf-nova-ai.com"}" style="display:inline-block; margin-top:12px; background:#c9a227; color:#0c0c0d; padding:11px 22px; border-radius:4px; text-decoration:none; font-weight:bold; font-size:13px;">Voir le pronostic du jour</a>`
  );
  await envoyerEmail(env, { to: email, subject: "Bienvenue sur Turf Nova AI", html });
}

async function envoyerEmailPaiementConfirme(env, email, plan) {
  const html = emailShell(
    "Paiement confirmé ✓",
    `<p style="font-size:14px; line-height:1.6;">Ton abonnement <b>${NOMS_PLANS[plan] || plan}</b> est actif. Merci pour ta confiance !</p>
     <p style="font-size:14px; line-height:1.6;">Tu as désormais un accès complet au Pronostic Premium (sélection détaillée) sur toutes les courses, sans limite.</p>
     <a href="https://${env.SITE_DOMAIN || "turf-nova-ai.com"}" style="display:inline-block; margin-top:12px; background:#c9a227; color:#0c0c0d; padding:11px 22px; border-radius:4px; text-decoration:none; font-weight:bold; font-size:13px;">Accéder au site</a>`
  );
  await envoyerEmail(env, { to: email, subject: "Ton abonnement Turf Nova AI est actif", html });
}

// Formule actuelle : un seul abonnement « Premium », en version mensuelle ou annuelle.
// "prestige" et "quinzaine" (anciennes formules Prestige / Derby) restent valides pour que les
// abonnés déjà inscrits gardent leur accès jusqu'à la fin de leur période payée.
const PLANS_VALIDES = ["gratuit", "mensuel", "annuel", "prestige", "quinzaine"];
const PLANS_PAYANTS = ["mensuel", "annuel", "prestige", "quinzaine"];
const NOMS_PLANS = { mensuel: "Premium mensuel", annuel: "Premium annuel", prestige: "Prestige", quinzaine: "Derby" };

// Détermine si un compte a un accès Premium actif (plan payant en cours). Le plan
// "essai" a été retiré : le pronostic PREMIUM est désormais réservé aux seuls
// abonnés payants, la sélection gratuite du jour (5 valeurs sûres) étant elle accessible
// à tous sans compte.
async function verifierAccesPremium(env, email) {
  if (!env.DB) return { actif: true }; // pas de restriction si pas de base configurée
  const sub = await env.DB.prepare(`SELECT plan, status, expires_at FROM subscriptions WHERE email = ?`)
    .bind(email)
    .first();

  if (!sub || sub.plan === "gratuit") return { actif: false };
  if (sub.status !== "active") return { actif: false };

  if (PLANS_PAYANTS.includes(sub.plan)) {
    if (sub.expires_at && sub.expires_at < Date.now()) {
      return { actif: false };
    }
    return { actif: true };
  }
  return { actif: false };
}

async function handleAbonnementMe(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const email = await getSessionUser(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: "auth_required" }), { status: 401, headers: corsHeaders });
  }
  if (!env.DB) {
    return new Response(JSON.stringify({ plan: "gratuit", status: "active" }), { headers: corsHeaders });
  }

  const sub = await env.DB.prepare(`SELECT plan, status, started_at, expires_at FROM subscriptions WHERE email = ?`)
    .bind(email)
    .first();

  if (!sub) {
    return new Response(JSON.stringify({ plan: "gratuit", status: "active" }), { headers: corsHeaders });
  }
  const reponse = { ...sub };
  const acces = await verifierAccesPremium(env, email);
  if (acces.actif && !estAdminEmail(env, email)) {
    reponse.quota_ia = etatQuotaIA(await lireQuotaIA(env, email));
  }
  return new Response(JSON.stringify(reponse), { headers: corsHeaders });
}

// Choix instantané du plan gratuit uniquement — les plans payants passent par Chariow
// (/api/paiement/initier) ; l'admin peut aussi les activer à la main (/api/admin/abonnement/statut).
// --- Paiement Chariow ---
// Nécessite le secret Cloudflare CHARIOW_API_KEY (clé secrète, jamais dans le code) et un webhook
// « Pulse » Chariow pointant vers /api/webhooks/chariow (événement sale.completed).

const CHARIOW_API_BASE = "https://api.chariow.com/v1";
// Les prix sont définis dans Chariow (pas dans ce code). Deux produits :
//   • « Abonnement Premium — mensuel » à 25 000 FCFA → prd_eijpfgbq
//   • « Abonnement Premium — annuel »  à 50 000 FCFA → prd_7w9pduoj
// Les anciennes formules « prestige » et « quinzaine » n'ont volontairement plus de produit ici :
// ces identifiants sont désormais ceux du mensuel / annuel, et laisser l'ancien nom permettrait de
// payer 25 000 / 50 000 FCFA pour une durée de 14 jours / 2 mois. Les ventes déjà en cours restent
// honorées par le webhook (la durée vient de DUREE_PLAN_MS, pas de cette table).
const PRODUITS_CHARIOW = {
  mensuel: "prd_eijpfgbq", // 25 000 FCFA — 30 jours
  annuel: "prd_7w9pduoj", // 50 000 FCFA — 365 jours
};

// Durée d'accès accordée par plan payant, utilisée à l'activation (webhook et activation manuelle admin).
const DUREE_PLAN_MS = {
  mensuel: 30 * 24 * 60 * 60 * 1000, // Premium mensuel — 30 jours
  annuel: 365 * 24 * 60 * 60 * 1000, // Premium annuel — 365 jours
  prestige: 60 * 24 * 60 * 60 * 1000, // ancien plan "Prestige" — 2 mois
  quinzaine: 14 * 24 * 60 * 60 * 1000,
};

async function chariowRequest(path, options, env) {
  if (!env.CHARIOW_API_KEY) {
    throw new Error("Paiement non configuré (clé Chariow manquante)");
  }
  const res = await fetch(`${CHARIOW_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.CHARIOW_API_KEY}`,
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "Erreur Chariow");
  }
  return data;
}

// Table minimale indicatif → code pays ISO2, complétée au besoin.
function paysDepuisIndicatif(indicatif) {
  const table = {
    225: "CI", 221: "SN", 223: "ML", 226: "BF", 227: "NE", 228: "TG", 229: "BJ",
    233: "GH", 234: "NG", 237: "CM", 241: "GA", 242: "CG", 243: "CD",
    33: "FR", 32: "BE", 41: "CH", 1: "US", 44: "GB",
  };
  return table[indicatif] || "CI";
}

// Démarre un paiement Chariow pour l'utilisateur connecté et renvoie l'URL de paiement.
async function handlePaiementInitier(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const email = await getSessionUser(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: "auth_required" }), { status: 401, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const plan = String(body.plan || "mensuel");
  const productId = PRODUITS_CHARIOW[plan];
  if (!productId) {
    return new Response(JSON.stringify({ error: "Plan payant inconnu" }), { status: 400, headers: corsHeaders });
  }
  // Tant que l'identifiant du produit Chariow n'a pas été renseigné, on ne tente pas le paiement.
  if (productId.includes("REMPLACER")) {
    return new Response(
      JSON.stringify({ error: "Cette formule n'est pas encore disponible au paiement. Réessaie bientôt." }),
      { status: 503, headers: corsHeaders }
    );
  }

  const userRaw = await env.CACHE_KV.get(`user:${email}`);
  const user = userRaw ? JSON.parse(userRaw) : {};
  const telephone = String(body.telephone || user.telephone || "");
  const match = telephone.match(/^\+(\d{1,3})(\d{6,14})$/);
  if (!match) {
    return new Response(
      JSON.stringify({ error: "Numéro de téléphone requis, format international (+2250700000000)" }),
      { status: 400, headers: corsHeaders }
    );
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const ip = request.headers.get("CF-Connecting-IP") || undefined;

  try {
    const result = await chariowRequest(
      "/checkout",
      {
        method: "POST",
        body: JSON.stringify({
          product_id: productId,
          email,
          first_name: String(body.prenom || email.split("@")[0]).slice(0, 50),
          last_name: String(body.nom || "Turf").slice(0, 50),
          phone: { number: match[2], country_code: paysDepuisIndicatif(match[1]) },
          customer_ip: ip,
          redirect_url: `${origin}/?paiement=succes&plan=${plan}`,
          custom_metadata: { app_email: email, app_plan: plan },
        }),
      },
      env
    );

    const step = result?.data?.step;
    if (step === "payment") {
      return new Response(
        JSON.stringify({ ok: true, checkout_url: result.data.payment.checkout_url }),
        { headers: corsHeaders }
      );
    }
    if (step === "already_purchased") {
      return new Response(
        JSON.stringify({ error: "Tu as déjà un achat en cours pour ce produit — vérifie ton compte." }),
        { status: 409, headers: corsHeaders }
      );
    }
    return new Response(JSON.stringify({ ok: true, step }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// Webhook Chariow (Pulse) : reçu à chaque changement de statut de vente.
// Par sécurité, on ne fait jamais confiance au contenu du payload tel quel :
// on re-vérifie la vente directement auprès de l'API Chariow avec notre clé secrète
// avant d'activer quoi que ce soit (évite qu'un tiers puisse forger une fausse requête).
async function handleChariowWebhook(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("invalid payload", { status: 400 });
  }

  const event = body?.event;
  const saleId = body?.data?.id;
  if (event !== "sale.completed" || !saleId) {
    return new Response("ignored", { status: 200 });
  }

  try {
    const verif = await chariowRequest(`/sales/${saleId}`, { method: "GET" }, env);
    const sale = verif?.data;
    if (!sale || sale.status !== "completed") {
      return new Response("not completed", { status: 200 });
    }

    const appEmail = sale.custom_metadata?.app_email || sale.customer?.email;
    const appPlan = sale.custom_metadata?.app_plan || "mensuel";
    if (!appEmail || !env.DB) {
      return new Response("ok", { status: 200 });
    }

    const now = Date.now();
    const dureeMs = DUREE_PLAN_MS[appPlan] || DUREE_PLAN_MS.mensuel;

    const existant = await env.DB.prepare(`SELECT expires_at FROM subscriptions WHERE email = ?`).bind(appEmail).first();
    const baseDepart = existant?.expires_at && existant.expires_at > now ? existant.expires_at : now;
    const expiresAt = baseDepart + dureeMs;

    const ecrire = (nomPlan) =>
      env.DB.prepare(
        `INSERT INTO subscriptions (email, plan, status, started_at, expires_at)
         VALUES (?, ?, 'active', ?, ?)
         ON CONFLICT(email) DO UPDATE SET plan = excluded.plan, status = 'active', expires_at = excluded.expires_at`
      ).bind(appEmail, nomPlan, now, expiresAt).run();
    try {
      await ecrire(appPlan);
    } catch (errPlan) {
      // Si la base refuse les nouveaux noms de plan (contrainte héritée des anciennes formules),
      // on enregistre l'accès sous l'ancien nom "prestige" : la durée (expires_at) reste la bonne.
      if (appPlan === "mensuel" || appPlan === "annuel") {
        console.warn(`[paiement] plan "${appPlan}" refusé par la base, repli sur "prestige" : ${errPlan.message}`);
        await ecrire("prestige");
      } else {
        throw errPlan;
      }
    }

    await envoyerEmailPaiementConfirme(env, appEmail, appPlan);

    return new Response("ok", { status: 200 });
  } catch (e) {
    // On répond 200 quand même pour éviter que Chariow ne retente en boucle sur une
    // erreur de notre côté ; l'admin peut toujours activer manuellement en secours.
    return new Response("error logged", { status: 200 });
  }
}

async function handleAbonnementChoisir(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const email = await getSessionUser(request, env);
  if (!email) {
    return new Response(JSON.stringify({ error: "auth_required" }), { status: 401, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }

  const plan = String(body.plan || "");
  if (plan !== "gratuit") {
    return new Response(
      JSON.stringify({ error: "Ce plan nécessite un paiement — utilise /api/paiement/initier" }),
      { status: 400, headers: corsHeaders }
    );
  }
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Base de données non configurée" }), { status: 503, headers: corsHeaders });
  }

  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO subscriptions (email, plan, status, started_at, expires_at)
     VALUES (?, 'gratuit', 'active', ?, NULL)
     ON CONFLICT(email) DO UPDATE SET plan = 'gratuit', status = 'active', started_at = excluded.started_at, expires_at = NULL`
  )
    .bind(email, now)
    .run();

  return new Response(JSON.stringify({ ok: true, plan: "gratuit", status: "active" }), { headers: corsHeaders });
}

// --- Suivi de fréquentation (visiteurs quotidiens/mensuels, pages vues) ---
// Aucune donnée personnelle stockée : l'IP + le navigateur sont hashés (SHA-256)
// avant tout enregistrement, uniquement pour distinguer un visiteur d'un autre.

function estRobot(userAgent) {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|uptime|headless/i.test(userAgent);
}

async function enregistrerVisite(request, env, path) {
  if (!env.DB) return;
  const ua = request.headers.get("user-agent") || "";
  if (estRobot(ua)) return;
  try {
    const ip = request.headers.get("cf-connecting-ip") || "";
    const enc = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${ip}|${ua}`));
    const visitorHash = bytesToHex(new Uint8Array(digest));
    await env.DB.prepare(
      `INSERT INTO page_views (day, visitor_hash, path, created_at) VALUES (?, ?, ?, ?)`
    )
      .bind(todayISO(), visitorHash, path, Date.now())
      .run();
  } catch (e) {
    // Le suivi de fréquentation ne doit jamais faire échouer l'affichage d'une page.
  }
}

async function handleAdminStatsVisites(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  }
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Base de données indisponible" }), { status: 500, headers: corsHeaders });
  }

  const jour = todayISO();
  const moisPrefix = jour.slice(0, 7); // "AAAA-MM"

  try {
    const [visiteursJour, pagesVuesJour, visiteursMois, pagesVuesMois] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(DISTINCT visitor_hash) AS n FROM page_views WHERE day = ?`).bind(jour).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM page_views WHERE day = ?`).bind(jour).first(),
      env.DB.prepare(`SELECT COUNT(DISTINCT visitor_hash) AS n FROM page_views WHERE day LIKE ?`).bind(`${moisPrefix}%`).first(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM page_views WHERE day LIKE ?`).bind(`${moisPrefix}%`).first(),
    ]);

    return new Response(
      JSON.stringify({
        visiteursJour: visiteursJour?.n || 0,
        pagesVuesJour: pagesVuesJour?.n || 0,
        visiteursMois: visiteursMois?.n || 0,
        pagesVuesMois: pagesVuesMois?.n || 0,
      }),
      { headers: corsHeaders }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Impossible de calculer les statistiques", details: e.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}

// --- Espace administrateur (protégé par ADMIN_EMAIL) ---

async function requireAdmin(request, env) {
  const email = await getSessionUser(request, env);
  if (!email || !env.ADMIN_EMAIL || email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
    return null;
  }
  return email;
}

// Liste tous les comptes inscrits (KV) avec leur statut d'abonnement (D1, s'il existe).
// Fonction partagée entre la liste admin et l'envoi de mails marketing par segment.
async function listerClients(env) {
  const liste = await env.CACHE_KV.list({ prefix: "user:" });
  const utilisateurs = [];

  for (const key of liste.keys) {
    const email = key.name.slice("user:".length);
    const user = await env.CACHE_KV.get(key.name, { type: "json" });
    if (!user) continue;

    let abonnement = { plan: "gratuit", status: "active", expires_at: null };
    if (env.DB) {
      try {
        const sub = await env.DB.prepare(
          `SELECT plan, status, expires_at FROM subscriptions WHERE email = ?`
        )
          .bind(email)
          .first();
        if (sub) abonnement = sub;
      } catch {
        // on garde les valeurs par défaut si la requête échoue
      }
    }

    utilisateurs.push({
      email,
      actif: user.actif !== false,
      createdAt: user.createdAt || null,
      plan: abonnement.plan,
      abonnementStatus: abonnement.status,
      expiresAt: abonnement.expires_at,
    });
  }

  utilisateurs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return utilisateurs;
}

async function handleAdminUtilisateurs(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  }

  const utilisateurs = await listerClients(env);
  return new Response(JSON.stringify({ utilisateurs }), { headers: corsHeaders });
}

// Envoi d'un mail marketing à un segment de clients (compte admin uniquement).
// segment : "tous" | "gratuit" (aucun abonnement payant actif) | "abonnes" (abonnements Premium actifs).
async function handleAdminEmailMarketing(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON invalide" }), { status: 400, headers: corsHeaders });
  }

  const sujet = String(body.subject || "").trim();
  const corpsHtml = String(body.html || "").trim();
  const segment = body.segment || "tous";

  if (!sujet || !corpsHtml) {
    return new Response(JSON.stringify({ error: "Sujet et contenu du mail requis" }), { status: 400, headers: corsHeaders });
  }

  const tousLesClients = await listerClients(env);
  const clientsActifs = tousLesClients.filter((c) => c.actif);

  let cibles;
  if (segment === "abonnes") {
    cibles = clientsActifs.filter((c) => c.plan !== "gratuit" && c.abonnementStatus === "active");
  } else if (segment === "gratuit") {
    cibles = clientsActifs.filter((c) => c.plan === "gratuit" || c.abonnementStatus !== "active");
  } else {
    cibles = clientsActifs;
  }

  const destinataires = cibles.map((c) => c.email);
  if (destinataires.length === 0) {
    return new Response(JSON.stringify({ envoyes: 0, ignores: 0, total: 0, message: "Aucun destinataire dans ce segment" }), { headers: corsHeaders });
  }

  const html = emailShell(sujet, corpsHtml);
  const resultat = await envoyerEmailBatch(env, { subject: sujet, html, destinataires });

  return new Response(
    JSON.stringify({ total: destinataires.length, envoyes: resultat.envoyes, ignores: resultat.ignores, erreur: resultat.erreur || null }),
    { headers: corsHeaders }
  );
}

// Active / désactive un compte entier (bloque la connexion et coupe l'accès immédiatement).
async function handleAdminCompteStatut(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const actif = !!body.actif;

  const user = await env.CACHE_KV.get(`user:${email}`, { type: "json" });
  if (!user) {
    return new Response(JSON.stringify({ error: "Compte introuvable" }), { status: 404, headers: corsHeaders });
  }

  user.actif = actif;
  await env.CACHE_KV.put(`user:${email}`, JSON.stringify(user));

  return new Response(JSON.stringify({ ok: true, email, actif }), { headers: corsHeaders });
}

// Modifie le plan / statut d'abonnement d'un utilisateur (contrôle admin, sans passer par le choix self-service).
async function handleAdminAbonnementStatut(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  }
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Base de données non configurée" }), { status: 503, headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const plan = String(body.plan || "gratuit");
  const status = String(body.status || "active");

  if (!PLANS_VALIDES.includes(plan)) {
    return new Response(JSON.stringify({ error: "Plan invalide" }), { status: 400, headers: corsHeaders });
  }
  if (!["active", "suspendu", "annule"].includes(status)) {
    return new Response(JSON.stringify({ error: "Statut invalide" }), { status: 400, headers: corsHeaders });
  }

  const now = Date.now();
  const expiresAt = plan === "gratuit" ? null : now + (DUREE_PLAN_MS[plan] || 30 * 24 * 60 * 60 * 1000);

  await env.DB.prepare(
    `INSERT INTO subscriptions (email, plan, status, started_at, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET plan = excluded.plan, status = excluded.status, expires_at = excluded.expires_at`
  )
    .bind(email, plan, status, now, expiresAt)
    .run();

  return new Response(JSON.stringify({ ok: true, email, plan, status }), { headers: corsHeaders });
}

async function loadCoursesDuJour() {
  const date = todayParam();
  const programme = await fetchJSON(`${PMU_BASE}/programme/${date}`);
  const reunions = programme.programme?.reunions || [];

  const cards = [];
  for (const reunion of reunions) {
    const numReunion = reunion.numOfficiel ?? reunion.numExterne;
    const hippodrome = reunion.hippodrome?.libelleCourt || reunion.libelleCourt || "";

    for (const course of reunion.courses || []) {
      const numCourse = course.numOrdre ?? course.numExterne;
      const { favori, nbPartants } = await getFavori(date, numReunion, numCourse);

      cards.push({
        reunion: `R${numReunion}`,
        course: `C${numCourse}`,
        hippodrome,
        heure: formatHeure(course.heureDepart),
        discipline: course.discipline || course.specialite || "",
        distance: course.distance || null,
        partants: course.nombreDeclaresPartants ?? nbPartants,
        favori,
      });
    }
  }
  return cards;
}

async function handleCoursesDuJour(env) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
  const cached = await env.CACHE_KV.get(CACHE_KEY, { type: "json" });
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return new Response(
      JSON.stringify({ source: "cache", updatedAt: cached.fetchedAt, courses: cached.courses }),
      { headers: corsHeaders }
    );
  }

  try {
    const courses = await loadCoursesDuJour();
    const payload = { courses, fetchedAt: now };
    await env.CACHE_KV.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: 300 });
    return new Response(
      JSON.stringify({ source: "live", updatedAt: now, courses }),
      { headers: corsHeaders }
    );
  } catch (e) {
    if (cached) {
      return new Response(
        JSON.stringify({
          source: "stale-cache",
          updatedAt: cached.fetchedAt,
          courses: cached.courses,
          warning: e.message,
        }),
        { headers: corsHeaders }
      );
    }
    return new Response(
      JSON.stringify({ error: "Impossible de récupérer le programme PMU", details: e.message }),
      { status: 502, headers: corsHeaders }
    );
  }
}

// --- Expiration automatique des abonnements ---
// L'accès est déjà coupé en temps réel dès que expires_at est dépassé (voir
// verifierAccesPremium, basé sur Date.now() côté serveur — infalsifiable par le client).
// Cette tâche planifiée vient en complément : elle rétrograde en base les abonnements
// expirés vers 'gratuit', pour que la table reflète toujours l'état réel (utile pour
// le tableau de bord admin et toute autre logique qui lirait le plan directement).
async function expirerAbonnements(env) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `UPDATE subscriptions
       SET plan = 'gratuit', expires_at = NULL
       WHERE plan != 'gratuit' AND status = 'active' AND expires_at IS NOT NULL AND expires_at < ?`
    )
      .bind(Date.now())
      .run();
  } catch {
    // Sans effet sur l'accès (déjà coupé en temps réel) : on retentera au prochain passage du cron.
  }
}

// --- Course du Jour (Quinté+ commun PMU, mis en avant sur la page d'accueil) ---
// L'admin choisit chaque jour la réunion/course concernée (voir handleAdminCourseDuJour).
// Par défaut R1/C3 si rien n'est configuré.

const COURSE_DU_JOUR_CONFIG_KEY = "course-du-jour-config";
const COURSE_DU_JOUR_TTL_SECONDS = 3 * 60 * 60; // 3h — évite d'appeler les IA à chaque visite

// ---------------------------------------------------------------------------
// DÉTECTION AUTOMATIQUE de la course « Quinté+ » du jour
// ---------------------------------------------------------------------------
// Le PMU signale dans son programme les paris ouverts sur chaque course : la course du jour est celle
// où figure le Quinté+. On cherche donc la mention « QUINTE » dans les paris de chaque course.
// Ordre de priorité : 1) réglage manuel de l'admin POUR AUJOURD'HUI, 2) détection automatique,
// 3) dernier réglage connu, 4) R1 C3. Le réglage manuel ne vaut que pour la journée où il est saisi.
const QUINTE_RE = /QUINT[EÉ]/i;

// Cherche « Quinté » dans un objet : d'abord dans les champs de paris (clé contenant « pari »),
// puis, à défaut, dans toutes les valeurs texte (profondeur limitée).
function mentionneQuinte(obj, seulementParis, profondeur = 0, cleParent = "") {
  if (obj == null || profondeur > 5) return false;
  if (typeof obj === "string") return (!seulementParis || /pari/i.test(cleParent)) && QUINTE_RE.test(obj);
  if (Array.isArray(obj)) return obj.some((v) => mentionneQuinte(v, seulementParis, profondeur + 1, cleParent));
  if (typeof obj === "object") {
    return Object.entries(obj).some(
      ([k, v]) => mentionneQuinte(v, seulementParis, profondeur + 1, seulementParis && /pari/i.test(cleParent) ? cleParent : k)
    );
  }
  return false;
}

function choisirCourseQuinte(reunions) {
  const candidates = [];
  for (const r of reunions || []) {
    for (const c of r.courses || []) candidates.push({ r, c });
  }
  for (const seulementParis of [true, false]) {
    const trouvees = candidates.filter(({ c }) => mentionneQuinte(c, seulementParis));
    if (trouvees.length) {
      // En cas de doute (plusieurs courses marquées) : la plus dotée, puis la plus tôt.
      trouvees.sort(
        (a, b) =>
          (b.c.montantPrix ?? b.c.montantTotalOffert ?? 0) - (a.c.montantPrix ?? a.c.montantTotalOffert ?? 0) ||
          (a.c.heureDepart ?? 0) - (b.c.heureDepart ?? 0)
      );
      const { r, c } = trouvees[0];
      return {
        reunion: `R${r.numOfficiel ?? r.numExterne}`,
        course: `C${c.numOrdre ?? c.numExterne}`,
        hippodrome: r.hippodrome?.libelleCourt || r.libelleCourt || "",
        heure: c.heureDepart ? formatHeure(c.heureDepart) : "",
        candidates: trouvees.length,
        via: seulementParis ? "paris" : "texte",
      };
    }
  }
  return null;
}

async function detecterCourseQuinte(date) {
  const diag = { reunions: 0, courses: 0, exempleCles: null };
  let programme;
  try {
    programme = await fetchJSON(`${PMU_BASE}/programme/${date}`);
  } catch (e) {
    return { trouve: null, diag: { ...diag, erreur: e.message } };
  }
  const reunions = programme.programme?.reunions || [];
  diag.reunions = reunions.length;
  diag.courses = reunions.reduce((n, r) => n + (r.courses || []).length, 0);
  diag.exempleCles = Object.keys(reunions[0]?.courses?.[0] || {});

  let trouve = choisirCourseQuinte(reunions);
  if (!trouve) {
    // Certaines données de paris ne sont que dans le détail de la réunion : on le lit (une requête par réunion).
    const details = [];
    for (const r of reunions.slice(0, 12)) {
      const num = r.numOfficiel ?? r.numExterne;
      try {
        const d = await fetchJSON(`${PMU_BASE}/programme/${date}/R${num}`);
        details.push({ ...r, courses: d.courses || d.reunion?.courses || d.programme?.courses || r.courses });
      } catch {
        /* réunion illisible : on passe à la suivante */
      }
    }
    trouve = choisirCourseQuinte(details);
    if (trouve) trouve.via += "+détail";
  }
  return { trouve, diag };
}

async function getCourseDuJourConfig(env) {
  const date = todayParam();
  const config = await env.CACHE_KV.get(COURSE_DU_JOUR_CONFIG_KEY, { type: "json" });

  // 1) Réglage manuel de l'admin, valable uniquement pour la journée où il a été saisi.
  if (config?.manuel && config.date === date && config.reunion && config.course) {
    return { reunion: config.reunion, course: config.course, source: "manuel" };
  }

  // 2) Détection automatique (mise en cache ; absence mémorisée 5 min pour ne pas relancer à chaque visiteur).
  const cleAuto = `quinte-auto:${date}`;
  const enCache = await env.CACHE_KV.get(cleAuto, { type: "json" });
  if (enCache) return { reunion: enCache.reunion, course: enCache.course, source: "auto" };
  if (!(await env.CACHE_KV.get(`quinte-auto-absent:${date}`))) {
    const { trouve } = await detecterCourseQuinte(date);
    if (trouve) {
      await env.CACHE_KV.put(cleAuto, JSON.stringify(trouve), { expirationTtl: 6 * 3600 });
      return { reunion: trouve.reunion, course: trouve.course, source: "auto" };
    }
    await env.CACHE_KV.put(`quinte-auto-absent:${date}`, "1", { expirationTtl: 300 });
    console.warn(`[course-du-jour] Quinté+ non détecté pour le ${date} — repli sur le dernier réglage`);
  }

  // 3) Dernier réglage connu, 4) valeur par défaut.
  if (config?.reunion && config?.course) return { reunion: config.reunion, course: config.course, source: "repli" };
  return { reunion: "R1", course: "C3", source: "defaut" };
}

// Sélection GRATUITE : les "valeurs sûres" = les 5 favoris du marché (cotes les plus basses).
// Volontairement PAS le classement de l'IA : le gratuit montre qui est favori, le Premium dit
// lesquels sont de VRAIES bases, et donne les outsiders et tocards.
// (Aucun appel IA : seules les cotes PMU sont utilisées.)
// Pour changer le nombre de chevaux gratuits : GRATUIT_NB_CHEVAUX.
const GRATUIT_NB_CHEVAUX = 5;
// Repère les jockeys/drivers "en forme" : au moins 2 victoires (position réelle = 1)
// parmi les courses analysées par le site sur les 30 derniers jours. Basé sur
// courses_features, déjà alimentée et mise à jour après chaque course vérifiée —
// aucune donnée supplémentaire à collecter. Mis en cache 6h pour éviter une requête
// D1 à chaque visite de la page.
const JOCKEYS_FORME_CACHE_KEY = "jockeys-en-forme";
const JOCKEYS_FORME_FENETRE_JOURS = 30;
const JOCKEYS_FORME_MIN_VICTOIRES = 2;

async function recupererJockeysEnForme(env) {
  const cache = await env.CACHE_KV.get(JOCKEYS_FORME_CACHE_KEY, { type: "json" });
  if (cache) return new Set(cache);
  if (!env.DB) return new Set();

  const cutoff = new Date(Date.now() - JOCKEYS_FORME_FENETRE_JOURS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  try {
    const { results } = await env.DB.prepare(
      `SELECT driver, COUNT(*) as victoires
       FROM courses_features
       WHERE position_reelle = 1 AND driver IS NOT NULL AND driver != '' AND date >= ?
       GROUP BY driver
       HAVING victoires >= ?`
    )
      .bind(cutoff, JOCKEYS_FORME_MIN_VICTOIRES)
      .all();

    const noms = (results || []).map((r) => r.driver.trim().toLowerCase());
    await env.CACHE_KV.put(JOCKEYS_FORME_CACHE_KEY, JSON.stringify(noms), { expirationTtl: 6 * 60 * 60 });
    return new Set(noms);
  } catch {
    return new Set();
  }
}

function construireSelectionGratuite(participants, quarte8, jockeysEnForme) {
  const partants = (participants || []).filter((p) => !p.nonPartant);
  if (!partants.length) return null;

  const cote = (p) => p?.dernierRapportDirect?.rapport ?? Infinity;
  // Favoris du marché : cotes croissantes (les chevaux sans cote connue passent en dernier).
  const favoris = partants.slice().sort((a, b) => cote(a) - cote(b) || a.numPmu - b.numPmu).slice(0, GRATUIT_NB_CHEVAUX);

  const toItem = (p) => {
    const jockey = p.driver?.nom || p.entraineur?.nom || "";
    return {
      numero: p.numPmu,
      cheval: p.nom,
      jockey,
      cote: p.dernierRapportDirect?.rapport ?? null,
      enForme: jockey ? jockeysEnForme.has(jockey.trim().toLowerCase()) : false,
    };
  };

  return {
    valeursSures: favoris.map(toItem),
    outsiders: [], // réservés au Premium
    tocards: [], //   réservés au Premium
    nbAutres: partants.length - favoris.length, // partants non montrés (pour l'accroche vers le Premium)
  };
}

// Construit (et met en cache) la fiche complète de la « Course du jour » : infos PMU, pronostic
// des IA (verrouillé en base), sélection gratuite. Utilisée à la demande (premier visiteur) ET par
// la pré-génération planifiée, pour que l'écran s'affiche instantanément.
async function genererCourseDuJour(env, date, reunion, course) {
  const cacheKey = `course-du-jour-full-v3:${date}:${reunion}:${course}`;
  const [courseInfo, participantsData] = await Promise.all([
    getCourseInfo(date, reunion, course),
    fetchJSON(`${PMU_BASE}/programme/${date}/${reunion}/${course}/participants`).catch(() => null),
  ]);

  const participants = participantsData?.participants || [];
  const nbPartants = participants.filter((p) => !p.nonPartant).length || null;

  let quarte8 = null;
  let conseilsJeu = "";
  let confiance = null;
  let iaStatus = null;
  const jockeysEnForme = await recupererJockeysEnForme(env);

  if (participants.length) {
    // Passe par la même fonction que le pronostic "à la demande" (bouton
    // "Voir le pronostic IA") : garantit un résultat identique partout sur le
    // site pour une même course, verrouillé en base dès la première génération
    // — plutôt que de refaire un appel DeepSeek indépendant ici, qui pouvait
    // renvoyer un classement différent pour la même course (variabilité du
    // modèle) selon qu'on la voyait sur la home ou via "Analyser une course".
    const { consensus } = await obtenirPronosticConsensus(date, reunion, course, env);

    iaStatus = [
      { ia: "DeepSeek", ok: !!consensus && (consensus.sources || []).includes("DeepSeek"), raison: consensus ? ((consensus.sources || []).includes("DeepSeek") ? null : "N'a pas répondu pour cette course") : "Pas de consensus disponible" },
      { ia: "GPT Sol", ok: !!consensus && (consensus.sources || []).includes("GPT Sol"), raison: consensus ? ((consensus.sources || []).includes("GPT Sol") ? null : "Pas de réponse (clé OPENAI_API_KEY absente ou erreur)") : "Pas de consensus disponible" },
      { ia: "Gemini", ok: false, raison: "Désactivée" },
      { ia: "Groq", ok: false, raison: "Désactivée" },
      { ia: "Claude", ok: false, raison: "Désactivée" },
    ];

    if (consensus && consensus.confiance > 0) {
      quarte8 = consensus.quarte8
        .map((c) => {
          const p = participants.find((pp) => pp.numPmu === c.numero);
          const jockey = p?.driver?.nom || p?.entraineur?.nom || "";
          return {
            position: c.position, // rang de confiance IA d'origine, conservé à titre indicatif
            numero: c.numero,
            cheval: c.cheval,
            coupSur: c.coupSur,
            explication: c.explication || "",
            jockey,
            cote: p?.dernierRapportDirect?.rapport ?? null,
            enForme: jockey ? jockeysEnForme.has(jockey.trim().toLowerCase()) : false,
          };
        })
        // Le Premium suit le classement de l'IA (position 1 = son meilleur choix)
        // et non plus l'ordre des cotes : à l'arrivée, un ou deux chevaux à cote
        // moyenne ou élevée s'immiscent souvent parmi les meilleurs. La cote reste
        // renvoyée pour chaque cheval, à titre d'information.
        .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
      confiance = consensus.confiance;
      conseilsJeu = consensus.quarte8.find((c) => c.conseilsJeu)?.conseilsJeu || "";
    }
  }

  const gratuit = construireSelectionGratuite(participants, quarte8, jockeysEnForme);

  const full = {
    reunion,
    course,
    hippodrome: courseInfo.hippodrome || "",
    discipline: courseInfo.discipline || "",
    distance: courseInfo.distance || null,
    partants: nbPartants,
    gratuit,
    quarte8,
    confiance,
    conseilsJeu,
    iaStatus,
    updatedAt: Date.now(),
  };

  // Pronostic + confiance sont générés ensemble : soit les deux sont présents, soit
  // aucun. Si l'IA n'a pas pu répondre, on ne verrouille pas ce résultat vide 3h :
  // on réessaie dans 5 minutes (le temps que le PMU publie les infos manquantes).
  const resultatComplet = !!quarte8 && !!confiance;
  const ttl = resultatComplet ? COURSE_DU_JOUR_TTL_SECONDS : 5 * 60;
  await env.CACHE_KV.put(cacheKey, JSON.stringify(full), { expirationTtl: ttl });
  return full;
}

// ----------------------------------------------------------------------------
// PRÉ-GÉNÉRATION de la Course du jour (cron)
// ----------------------------------------------------------------------------
// Sans ça, le PREMIER visiteur de la journée attend l'analyse complète (DeepSeek + GPT Sol + web : 1 à
// 2 minutes) et les suivants ont le résultat en cache. Ici, un cron génère l'analyse à l'avance :
// tous les visiteurs, y compris le premier, ont un affichage instantané.
// Fenêtre : on génère à partir de PREGEN_AVANCE_H heures avant le départ (les non-partants sont alors
// presque tous connus : le pronostic est VERROUILLÉ en base et ne sera plus recalculé).
const CRON_PREGEN = "*/15 * * * *";   // à déclarer dans wrangler.jsonc (triggers.crons)
const PREGEN_AVANCE_H = 7;            // ouverture de la fenêtre avant le départ de la course
const PREGEN_MAX_TENTATIVES = 4;      // essais par jour si les IA échouent

async function heureDepartMs(date, reunion, course) {
  try {
    const programme = await fetchJSON(`${PMU_BASE}/programme/${date}`);
    const r = (programme.programme?.reunions || []).find((x) => `R${x.numOfficiel ?? x.numExterne}` === reunion);
    const c = (r?.courses || []).find((x) => `C${x.numOrdre ?? x.numExterne}` === course);
    return c?.heureDepart || null;
  } catch {
    return null;
  }
}

async function pregenererCourseDuJour(env, { forcer = false } = {}) {
  const date = todayParam();
  const { reunion, course } = await getCourseDuJourConfig(env);
  const cacheKey = `course-du-jour-full-v3:${date}:${reunion}:${course}`;
  const etatKey = `pregen:${date}:${reunion}:${course}`;
  const etat = (await env.CACHE_KV.get(etatKey, { type: "json" })) || { tentatives: 0, fait: false };

  if (!forcer && (etat.fait || etat.tentatives >= PREGEN_MAX_TENTATIVES)) return { statut: "rien_a_faire", ...etat };

  const dejaPret = await env.CACHE_KV.get(cacheKey, { type: "json" });
  if (dejaPret?.quarte8 && dejaPret?.confiance) {
    await env.CACHE_KV.put(etatKey, JSON.stringify({ ...etat, fait: true }), { expirationTtl: 36 * 3600 });
    return { statut: "deja_pret" };
  }

  if (!forcer) {
    const depart = await heureDepartMs(date, reunion, course);
    const maintenant = Date.now();
    if (depart && maintenant < depart - PREGEN_AVANCE_H * 3600 * 1000) return { statut: "trop_tot" };
    if (depart && maintenant > depart) return { statut: "course_partie" };
  }

  // On compte la tentative AVANT l'appel (les IA sont lentes et payantes : jamais de boucle infinie).
  etat.tentatives += 1;
  await env.CACHE_KV.put(etatKey, JSON.stringify(etat), { expirationTtl: 36 * 3600 });

  const full = await genererCourseDuJour(env, date, reunion, course);
  const reussi = !!full.quarte8 && !!full.confiance;
  if (reussi) await env.CACHE_KV.put(etatKey, JSON.stringify({ ...etat, fait: true }), { expirationTtl: 36 * 3600 });
  console.log(`[pregen] ${reunion}${course} du ${date} — ${reussi ? "OK" : "IA sans réponse"} (essai ${etat.tentatives}/${PREGEN_MAX_TENTATIVES})`);
  return { statut: reussi ? "genere" : "echec", tentatives: etat.tentatives };
}

async function handleAdminPregen(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  try {
    return new Response(JSON.stringify(await pregenererCourseDuJour(env, { forcer: true })), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
}

async function handleCourseDuJour(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const date = todayParam();
  const { reunion, course } = await getCourseDuJourConfig(env);
  const cacheKey = `course-du-jour-full-v3:${date}:${reunion}:${course}`;

  let full = await env.CACHE_KV.get(cacheKey, { type: "json" });

  if (!full) {
    try {
      full = await genererCourseDuJour(env, date, reunion, course);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Impossible de récupérer la course du jour", details: e.message }),
        { status: 502, headers: corsHeaders }
      );
    }
  }

  const base = {
    reunion: full.reunion,
    course: full.course,
    hippodrome: full.hippodrome,
    discipline: full.discipline,
    distance: full.distance,
    partants: full.partants,
    updatedAt: full.updatedAt,
    // Sélection gratuite (5 favoris du marché) — toujours renvoyée, sans compte ni abonnement.
    gratuit: full.gratuit,
    // Indice de confiance : affiché aussi dans la partie gratuite.
    confiance: full.confiance ?? null,
  };

  if (!full.quarte8) {
    return new Response(JSON.stringify({ ...base, premium: null, premiumVerrouille: false }), { headers: corsHeaders });
  }

  // Pronostic PREMIUM (8 numéros détaillés + coups sûrs) réservé aux comptes avec
  // abonnement Premium actif — plus d'essai gratuit, voir verifierAccesPremium.
  const email = await getSessionUser(request, env);
  const acces = email ? await verifierAccesPremium(env, email) : { actif: false };

  if (acces.actif) {
    return new Response(
      JSON.stringify({
        ...base,
        premium: { quarte8: full.quarte8, confiance: full.confiance, conseilsJeu: full.conseilsJeu || "" },
        premiumVerrouille: false,
      }),
      { headers: corsHeaders }
    );
  }

  return new Response(JSON.stringify({ ...base, premium: null, premiumVerrouille: true }), { headers: corsHeaders });
}

// Admin : lance la détection MAINTENANT (sans cache) et montre ce que le PMU renvoie — pour vérifier ou corriger la détection.
async function handleAdminDetecterQuinte(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  const date = todayParam();
  const { trouve, diag } = await detecterCourseQuinte(date);
  const config = await getCourseDuJourConfig(env);
  return new Response(JSON.stringify({ date, detecte: trouve, utilise: config, diagnostic: diag }), { headers: corsHeaders });
}

// Admin : change quelle réunion/course est mise en avant comme "Course du Jour".
async function handleAdminCourseDuJour(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  }

  if (request.method === "GET") {
    const config = await getCourseDuJourConfig(env);
    let iaStatus = null;
    let updatedAt = null;
    try {
      const date = todayParam();
      const full = await env.CACHE_KV.get(
        `course-du-jour-full-v3:${date}:${config.reunion}:${config.course}`,
        { type: "json" }
      );
      iaStatus = full?.iaStatus || null;
      updatedAt = full?.updatedAt || null;
    } catch {
      iaStatus = null;
    }
    return new Response(JSON.stringify({ ...config, iaStatus, updatedAt }), { headers: corsHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }

  // Retour au mode automatique : on retire le réglage manuel et la détection mémorisée.
  if (body.auto === true) {
    const date = todayParam();
    const ancien = await env.CACHE_KV.get(COURSE_DU_JOUR_CONFIG_KEY, { type: "json" });
    await env.CACHE_KV.put(COURSE_DU_JOUR_CONFIG_KEY, JSON.stringify({ ...(ancien || {}), manuel: false }));
    await env.CACHE_KV.delete(`quinte-auto:${date}`);
    await env.CACHE_KV.delete(`quinte-auto-absent:${date}`);
    const config = await getCourseDuJourConfig(env);
    return new Response(JSON.stringify({ ok: true, ...config }), { headers: corsHeaders });
  }

  const reunion = String(body.reunion || "").trim().toUpperCase();
  const course = String(body.course || "").trim().toUpperCase();

  if (!/^R\d+$/.test(reunion) || !/^C\d+$/.test(course)) {
    return new Response(
      JSON.stringify({ error: "Format invalide — attendu ex: reunion='R1', course='C3'" }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Le réglage manuel ne vaut que pour AUJOURD'HUI : demain, la détection automatique reprend la main.
  await env.CACHE_KV.put(COURSE_DU_JOUR_CONFIG_KEY, JSON.stringify({ reunion, course, manuel: true, date: todayParam() }));

  // On efface le cache du jour pour que le changement soit visible immédiatement.
  const date = todayParam();
  await env.CACHE_KV.delete(`course-du-jour-full-v3:${date}:${reunion}:${course}`);

  return new Response(JSON.stringify({ ok: true, reunion, course }), { headers: corsHeaders });
}

// --- Articles (blog) ---

function slugify(texte) {
  return texte
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function genererSlugUnique(env, base) {
  const racine = slugify(base) || "article";
  let slug = racine;
  let n = 1;
  while (true) {
    const existe = await env.DB.prepare(`SELECT id FROM articles WHERE slug = ?`).bind(slug).first();
    if (!existe) return slug;
    n += 1;
    slug = `${racine}-${n}`;
  }
}

// ============================================================================
// IMAGES (couvertures d'articles) — téléversement depuis l'admin, stockage dans le KV
// ----------------------------------------------------------------------------
// L'image est stockée telle quelle (binaire) sous `img:<id>` et servie sur /api/images/<id>.<ext>
// avec un cache très long (l'id est aléatoire et ne change jamais : « immutable »).
// Sécurité : seul l'admin peut téléverser ; le type est déterminé par les premiers octets du fichier
// (jamais par ce que déclare le client) ; SVG refusé (peut contenir du script) ; 3 Mo maximum.
// ============================================================================
const IMAGE_MAX_OCTETS = 3 * 1024 * 1024;

function detecterTypeImage(o) {
  const b = new Uint8Array(o.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: "image/png", ext: "png" };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { type: "image/gif", ext: "gif" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { type: "image/webp", ext: "webp" };
  return null;
}

const IMAGE_LOCALE_RE = /^\/api\/images\/[0-9a-f]{24}\.(jpg|png|gif|webp)$/;

// Une image de couverture est soit une image téléversée (/api/images/...), soit une adresse http(s) simple.
function imageCouvertureValide(u) {
  if (!u) return true;
  if (IMAGE_LOCALE_RE.test(u)) return true;
  return u.length <= 2000 && /^https?:\/\/[^\s"'<>\\]+$/i.test(u);
}

async function handleAdminUploadImage(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });

  const annonce = parseInt(request.headers.get("Content-Length"), 10);
  if (annonce > IMAGE_MAX_OCTETS) {
    return new Response(JSON.stringify({ error: "Image trop lourde (3 Mo maximum)." }), { status: 413, headers: corsHeaders });
  }
  const octets = await request.arrayBuffer();
  if (!octets.byteLength) return new Response(JSON.stringify({ error: "Fichier vide." }), { status: 400, headers: corsHeaders });
  if (octets.byteLength > IMAGE_MAX_OCTETS) {
    return new Response(JSON.stringify({ error: "Image trop lourde (3 Mo maximum)." }), { status: 413, headers: corsHeaders });
  }
  const format = detecterTypeImage(octets);
  if (!format) {
    return new Response(JSON.stringify({ error: "Format non accepté : utilise une image JPEG, PNG, WebP ou GIF." }), { status: 415, headers: corsHeaders });
  }

  const id = bytesToHex(crypto.getRandomValues(new Uint8Array(12)));
  await env.CACHE_KV.put(`img:${id}`, octets, { metadata: { type: format.type, taille: octets.byteLength, creeLe: Date.now() } });
  return new Response(JSON.stringify({ ok: true, url: `/api/images/${id}.${format.ext}` }), { headers: corsHeaders });
}

async function handleImagePublique(env, nom) {
  const m = /^([0-9a-f]{24})\.(jpg|png|gif|webp)$/.exec(nom);
  if (!m) return new Response("Introuvable", { status: 404 });
  const { value, metadata } = await env.CACHE_KV.getWithMetadata(`img:${m[1]}`, { type: "arrayBuffer" });
  if (!value) return new Response("Introuvable", { status: 404 });
  return new Response(value, {
    headers: {
      "Content-Type": metadata?.type || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// GET /api/articles — liste publique des articles publiés (pour blog.html).
// GET /sitemap.xml — généré dynamiquement (inclut chaque article publié).
// Remplace le fichier statique public/sitemap.xml, désormais inutilisé.
async function handleSitemap(env) {
  const domaine = env.SITE_DOMAIN || "turf-nova-ai-2.kambourodrigue.workers.dev";
  const base = `https://${domaine}`;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  const urls = [
    { loc: `${base}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${base}/blog.html`, changefreq: "daily", priority: "0.7" },
    { loc: `${base}/cgu.html`, changefreq: "monthly", priority: "0.3" },
    { loc: `${base}/confidentialite.html`, changefreq: "monthly", priority: "0.3" },
  ];

  if (env.DB) {
    try {
      const { results } = await env.DB.prepare(
        `SELECT slug, updated_at FROM articles WHERE statut = 'publie' ORDER BY published_at DESC LIMIT 1000`
      ).all();
      for (const a of results || []) {
        urls.push({
          loc: `${base}/article.html?slug=${encodeURIComponent(a.slug)}`,
          changefreq: "monthly",
          priority: "0.6",
          lastmod: iso(a.updated_at),
        });
      }
    } catch {
      // Si D1 est indisponible, on renvoie quand même le sitemap avec les pages statiques.
    }
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n    <loc>${u.loc}</loc>\n` +
          (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : "") +
          `    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      )
      .join("\n") +
    `\n</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}

async function handleArticlesPublics(env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (!env.DB) {
    return new Response(JSON.stringify({ articles: [] }), { headers: corsHeaders });
  }
  try {
    const { results } = await env.DB.prepare(
      `SELECT slug, titre, extrait, image_url, published_at FROM articles
       WHERE statut = 'publie' ORDER BY published_at DESC LIMIT 100`
    ).all();
    return new Response(JSON.stringify({ articles: results || [] }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Erreur base de données", details: e.message }), { status: 500, headers: corsHeaders });
  }
}

// GET /api/articles/:slug — un article publié (pour article.html).
async function handleArticlePublic(env, slug) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Article introuvable" }), { status: 404, headers: corsHeaders });
  }
  try {
    const article = await env.DB.prepare(
      `SELECT slug, titre, extrait, mots_cles, contenu, image_url, published_at FROM articles WHERE slug = ? AND statut = 'publie'`
    )
      .bind(slug)
      .first();
    if (!article) {
      return new Response(JSON.stringify({ error: "Article introuvable" }), { status: 404, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ article }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Erreur base de données", details: e.message }), { status: 500, headers: corsHeaders });
  }
}

// GET liste tous les articles (brouillons inclus) / POST en crée un — réservé à l'admin.
async function handleAdminArticles(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  }
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Base de données non configurée" }), { status: 503, headers: corsHeaders });
  }

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT id, slug, titre, extrait, mots_cles, image_url, statut, created_at, updated_at, published_at
       FROM articles ORDER BY created_at DESC`
    ).all();
    return new Response(JSON.stringify({ articles: results || [] }), { headers: corsHeaders });
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
    }

    const titre = String(body.titre || "").trim();
    const contenu = String(body.contenu || "").trim();
    if (!titre || !contenu) {
      return new Response(JSON.stringify({ error: "Titre et contenu requis" }), { status: 400, headers: corsHeaders });
    }

    const extrait = String(body.extrait || "").trim() || null;
    const motsCles = String(body.motsCles || "").trim() || null;
    const imageUrl = String(body.imageUrl || "").trim() || null;
    if (!imageCouvertureValide(imageUrl)) {
      return new Response(JSON.stringify({ error: "Image de couverture invalide : téléverse un fichier ou colle une adresse http(s)." }), { status: 400, headers: corsHeaders });
    }
    const statut = body.statut === "publie" ? "publie" : "brouillon";
    const now = Date.now();
    const slug = await genererSlugUnique(env, titre);

    await env.DB.prepare(
      `INSERT INTO articles (slug, titre, extrait, mots_cles, contenu, image_url, statut, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(slug, titre, extrait, motsCles, contenu, imageUrl, statut, now, now, statut === "publie" ? now : null)
      .run();

    return new Response(JSON.stringify({ ok: true, slug }), { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: "Méthode non supportée" }), { status: 405, headers: corsHeaders });
}

// PUT met à jour un article / DELETE le supprime — réservé à l'admin.
async function handleAdminArticleItem(request, env, id) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  }
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "Base de données non configurée" }), { status: 503, headers: corsHeaders });
  }

  if (request.method === "GET") {
    const article = await env.DB.prepare(`SELECT * FROM articles WHERE id = ?`).bind(id).first();
    if (!article) {
      return new Response(JSON.stringify({ error: "Article introuvable" }), { status: 404, headers: corsHeaders });
    }
    return new Response(JSON.stringify({ article }), { headers: corsHeaders });
  }

  if (request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
    }

    const existant = await env.DB.prepare(`SELECT * FROM articles WHERE id = ?`).bind(id).first();
    if (!existant) {
      return new Response(JSON.stringify({ error: "Article introuvable" }), { status: 404, headers: corsHeaders });
    }

    const titre = body.titre != null ? String(body.titre).trim() : existant.titre;
    const contenu = body.contenu != null ? String(body.contenu).trim() : existant.contenu;
    const extrait = body.extrait != null ? String(body.extrait).trim() || null : existant.extrait;
    const motsCles = body.motsCles != null ? String(body.motsCles).trim() || null : existant.mots_cles;
    const imageUrl = body.imageUrl != null ? String(body.imageUrl).trim() || null : existant.image_url;
    if (!imageCouvertureValide(imageUrl)) {
      return new Response(JSON.stringify({ error: "Image de couverture invalide : téléverse un fichier ou colle une adresse http(s)." }), { status: 400, headers: corsHeaders });
    }
    const statut = body.statut === "publie" || body.statut === "brouillon" ? body.statut : existant.statut;
    const now = Date.now();
    // Première publication : on fixe published_at. Si déjà publié avant, on ne l'écrase pas
    // (sinon un simple aller-retour brouillon/publié changerait la date affichée aux lecteurs).
    const publishedAt = statut === "publie" ? existant.published_at || now : existant.published_at;

    await env.DB.prepare(
      `UPDATE articles SET titre = ?, extrait = ?, mots_cles = ?, contenu = ?, image_url = ?, statut = ?, updated_at = ?, published_at = ?
       WHERE id = ?`
    )
      .bind(titre, extrait, motsCles, contenu, imageUrl, statut, now, publishedAt, id)
      .run();

    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(`DELETE FROM articles WHERE id = ?`).bind(id).run();
    return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ error: "Méthode non supportée" }), { status: 405, headers: corsHeaders });
}

// --- Rendu SEO côté serveur pour /article.html ---
// Le fichier statique sert de gabarit avec des méta par défaut ; on les remplace ici
// par le vrai titre/résumé/image de l'article avant d'envoyer la réponse. Nécessaire
// car les robots qui génèrent les aperçus de partage (WhatsApp, Facebook) lisent le
// HTML brut de la première réponse et n'exécutent jamais le JavaScript de la page.
async function handleArticlePage(request, env, url) {
  const reponse = await env.ASSETS.fetch(request);
  const slug = url.searchParams.get("slug");
  if (!slug || !env.DB) return reponse;

  let article;
  try {
    article = await env.DB.prepare(
      `SELECT titre, extrait, mots_cles, image_url, published_at, updated_at FROM articles WHERE slug = ? AND statut = 'publie'`
    )
      .bind(slug)
      .first();
  } catch {
    return reponse;
  }
  if (!article) return reponse;

  const domaine = env.SITE_DOMAIN || "turf-nova-ai-2.kambourodrigue.workers.dev";
  const titrePage = `${article.titre} — Turf Nova AI`;
  const description =
    article.extrait || "Turf Nova AI — pronostics hippiques PMU assistés par intelligence artificielle.";
  const image = article.image_url ? (article.image_url.startsWith("/") ? `https://${domaine}${article.image_url}` : article.image_url) : `https://${domaine}/favicon.svg`;
  const pageUrl = `https://${domaine}/article.html?slug=${encodeURIComponent(slug)}`;

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: article.titre,
    description,
    image,
    datePublished: article.published_at ? new Date(article.published_at).toISOString() : undefined,
    dateModified: new Date(article.updated_at || article.published_at || Date.now()).toISOString(),
    url: pageUrl,
    author: { "@type": "Organization", name: "Turf Nova AI" },
    publisher: { "@type": "Organization", name: "Turf Nova AI", logo: { "@type": "ImageObject", url: `https://${domaine}/favicon.svg` } },
    mainEntityOfPage: { "@type": "WebPage", "@id": pageUrl },
  });

  const rewriter = new HTMLRewriter()
    .on("title", { element(el) { el.setInnerContent(titrePage); } })
    .on('meta[name="description"]', { element(el) { el.setAttribute("content", description); } })
    .on("head", {
      element(el) {
        if (article.mots_cles) {
          el.append(`<meta name="keywords" content="${article.mots_cles.replace(/"/g, "&quot;")}">`, { html: true });
        }
      },
    })
    .on('link[rel="canonical"]', { element(el) { el.setAttribute("href", pageUrl); } })
    .on('meta[property="og:title"]', { element(el) { el.setAttribute("content", titrePage); } })
    .on('meta[property="og:description"]', { element(el) { el.setAttribute("content", description); } })
    .on('meta[property="og:image"]', { element(el) { el.setAttribute("content", image); } })
    .on('meta[property="og:url"]', { element(el) { el.setAttribute("content", pageUrl); } })
    .on('meta[name="twitter:title"]', { element(el) { el.setAttribute("content", titrePage); } })
    .on('meta[name="twitter:description"]', { element(el) { el.setAttribute("content", description); } })
    .on('meta[name="twitter:image"]', { element(el) { el.setAttribute("content", image); } })
    .on("head", { element(el) { el.append(`<script type="application/ld+json">${jsonLd}</script>`, { html: true }); } });

  return rewriter.transform(reponse);
}

// ============================================================================
// Notifications push (Web Push standard — VAPID + chiffrement aes128gcm)
//
// Aucune librairie externe : le worker est déployé comme fichier unique
// (pas de bundler/npm), donc tout le protocole RFC 8291 (chiffrement du
// message) et RFC 8292 (VAPID) est réimplémenté ici avec la Web Crypto API
// native, disponible nativement dans les Workers.
// ============================================================================

function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const raw = atob(b64 + pad);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes) {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function uint32BE(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

// JWT VAPID (RFC 8292), signé ES256 avec la clé privée du serveur, valide 12h.
// `audience` doit être l'origine (scheme+host) du endpoint push du destinataire.
async function creerJwtVapid(audience, subject, privateKeyB64url, publicKeyB64url) {
  const pubBytes = b64urlToBytes(publicKeyB64url); // 65 octets : 0x04 || x || y
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64url(pubBytes.slice(1, 33)),
    y: bytesToB64url(pubBytes.slice(33, 65)),
    d: privateKeyB64url,
    ext: true,
  };
  const cryptoKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const enc = new TextEncoder();
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = bytesToB64url(enc.encode(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: subject })));
  const signingInput = `${header}.${payload}`;

  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, enc.encode(signingInput));
  return `${signingInput}.${bytesToB64url(new Uint8Array(signature))}`;
}

// Chiffre le corps de la notification selon le content-encoding aes128gcm
// (RFC 8291) à partir des clés publiques de l'abonnement (p256dh + auth).
async function chiffrerPayloadPush(payloadBytes, p256dhB64url, authB64url) {
  const receiverPublic = b64urlToBytes(p256dhB64url); // 65 octets
  const authSecret = b64urlToBytes(authB64url); // 16 octets

  const serverKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));

  const receiverPublicKey = await crypto.subtle.importKey("raw", receiverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiverPublicKey }, serverKeyPair.privateKey, 256)
  );

  const enc = new TextEncoder();

  // Étape 1 : combine le secret ECDH et le secret "auth" de l'abonnement (spécifique Web Push).
  const stage1Key = await crypto.subtle.importKey("raw", ecdhSecret, "HKDF", false, ["deriveBits"]);
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: authSecret,
        info: concatBytes(enc.encode("WebPush: info\0"), receiverPublic, serverPublic),
      },
      stage1Key,
      256
    )
  );

  // Étape 2 : dérive la clé de chiffrement (CEK) et le nonce, avec un sel aléatoire
  // propre à ce message (content-encoding aes128gcm, RFC 8188).
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const stage2Key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const cek = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("Content-Encoding: aes128gcm\0") },
      stage2Key,
      128
    )
  );
  const nonce = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("Content-Encoding: nonce\0") },
      stage2Key,
      96
    )
  );

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 = délimiteur "dernier enregistrement" (un seul enregistrement ici, le message est court).
  const plaintext = concatBytes(payloadBytes, new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plaintext));

  const recordSize = 4096;
  const header = concatBytes(salt, uint32BE(recordSize), new Uint8Array([serverPublic.length]), serverPublic);
  return concatBytes(header, ciphertext);
}

// Envoie une notification à un seul abonnement. Retourne { ok, status, expired }
// — `expired` signale un endpoint mort (404/410) à supprimer de la base.
async function envoyerPushUnitaire(env, subscription, payloadObj) {
  const enc = new TextEncoder();
  const payloadBytes = enc.encode(JSON.stringify(payloadObj));
  const body = await chiffrerPayloadPush(payloadBytes, subscription.p256dh, subscription.auth);
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await creerJwtVapid(audience, env.VAPID_SUBJECT, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
  });

  return { ok: res.ok, status: res.status, expired: res.status === 404 || res.status === 410 };
}

// Crée la table des abonnements push si elle n'existe pas encore (sans effet sinon).
async function assurerTablePush(env) {
  if (!env.DB) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
       endpoint TEXT PRIMARY KEY,
       p256dh TEXT NOT NULL,
       auth TEXT NOT NULL,
       created_at INTEGER
     )`
  ).run();
}

async function handlePushSubscribe(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }

  const endpoint = String(body.endpoint || "");
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return new Response(JSON.stringify({ error: "Abonnement incomplet" }), { status: 400, headers: corsHeaders });
  }

  if (!env.DB) return new Response(JSON.stringify({ error: "Indisponible" }), { status: 503, headers: corsHeaders });

  await assurerTablePush(env);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)`
  )
    .bind(endpoint, p256dh, auth, Date.now())
    .run();

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

async function handlePushUnsubscribe(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Requête invalide" }), { status: 400, headers: corsHeaders });
  }

  if (env.DB && body.endpoint) {
    await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(String(body.endpoint)).run();
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

// Notification quotidienne "le pronostic du jour est prêt" — déclenchée par le
// cron de 6h. Protégée par un verrou KV pour ne jamais partir deux fois le
// même jour (ex. redéploiement qui relance le worker).
async function envoyerNotificationPronosticDuJour(env) {
  if (!env.DB || !env.VAPID_PRIVATE_KEY) return;

  const date = todayParam();
  const verrou = `notif-pronostic-envoyee:${date}`;
  const dejaEnvoyee = await env.CACHE_KV.get(verrou);
  if (dejaEnvoyee) return;
  await env.CACHE_KV.put(verrou, "1", { expirationTtl: 86400 });

  await assurerTablePush(env);
  const abonnes = await env.DB.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions`).all();
  const subs = abonnes.results || [];
  if (subs.length === 0) return;

  const payload = {
    title: "🐎 Le pronostic du jour est prêt",
    body: "Retrouve la sélection de l'IA, les coups sûrs et l'indice de confiance sur Turf Nova AI.",
    url: "/",
  };

  const resultats = await Promise.allSettled(subs.map((s) => envoyerPushUnitaire(env, s, payload)));

  const endpointsExpires = [];
  resultats.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.expired) endpointsExpires.push(subs[i].endpoint);
    if (r.status === "rejected") console.error("[push]", subs[i].endpoint, r.reason?.message || r.reason);
  });

  for (const endpoint of endpointsExpires) {
    await env.DB.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(endpoint).run();
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/sitemap.xml") {
      return handleSitemap(env);
    }

    if (url.pathname === "/article.html") {
      return handleArticlePage(request, env, url);
    }

    if (url.pathname === "/api/courses-du-jour") {
      return handleCoursesDuJour(env);
    }

    if (url.pathname === "/api/course-du-jour") {
      return handleCourseDuJour(request, env);
    }

    if (url.pathname === "/api/admin/course-du-jour") {
      return handleAdminCourseDuJour(request, env);
    }

    if (url.pathname === "/api/admin/upload-image" && request.method === "POST") {
      return handleAdminUploadImage(request, env);
    }

    if (url.pathname.startsWith("/api/images/") && request.method === "GET") {
      return handleImagePublique(env, url.pathname.slice("/api/images/".length));
    }

    if (url.pathname === "/api/articles") {
      return handleArticlesPublics(env);
    }

    const matchArticleSlug = url.pathname.match(/^\/api\/articles\/([a-z0-9-]+)$/);
    if (matchArticleSlug) {
      return handleArticlePublic(env, matchArticleSlug[1]);
    }

    if (url.pathname === "/api/admin/articles") {
      return handleAdminArticles(request, env);
    }

    const matchAdminArticleId = url.pathname.match(/^\/api\/admin\/articles\/(\d+)$/);
    if (matchAdminArticleId) {
      return handleAdminArticleItem(request, env, matchAdminArticleId[1]);
    }

    if (url.pathname === "/api/pronostic-ia") {
      return handlePronosticIA(request, env);
    }

    if (url.pathname === "/api/chat-ia" && request.method === "POST") {
      return handleChatIA(request, env);
    }

    if (url.pathname === "/api/resultats-du-jour") {
      return handleResultatsDuJour(env);
    }

    if (url.pathname === "/api/auth/signup" && request.method === "POST") {
      return handleSignup(request, env);
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    if (url.pathname === "/api/auth/mot-de-passe-oublie" && request.method === "POST") {
      return handleMotDePasseOublie(request, env);
    }

    if (url.pathname === "/api/auth/reinitialiser" && request.method === "POST") {
      return handleReinitialiserMotDePasse(request, env);
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return handleLogout(request, env);
    }

    if (url.pathname === "/api/auth/me") {
      return handleMe(request, env);
    }

    if (url.pathname === "/api/stats-performance") {
      return handleStatsPerformance(env);
    }

    if (url.pathname === "/api/abonnement/me") {
      return handleAbonnementMe(request, env);
    }

    if (url.pathname === "/api/abonnement/choisir" && request.method === "POST") {
      return handleAbonnementChoisir(request, env);
    }

    if (url.pathname === "/api/paiement/initier" && request.method === "POST") {
      return handlePaiementInitier(request, env);
    }

    if (url.pathname === "/api/webhooks/chariow" && request.method === "POST") {
      return handleChariowWebhook(request, env);
    }

    if (url.pathname === "/api/admin/utilisateurs") {
      return handleAdminUtilisateurs(request, env);
    }

    if (url.pathname === "/api/admin/email-marketing" && request.method === "POST") {
      return handleAdminEmailMarketing(request, env);
    }

    if (url.pathname === "/api/admin/compte/statut" && request.method === "POST") {
      return handleAdminCompteStatut(request, env);
    }

    if (url.pathname === "/api/admin/abonnement/statut" && request.method === "POST") {
      return handleAdminAbonnementStatut(request, env);
    }

    if (url.pathname === "/api/admin/detecter-quinte") {
      return handleAdminDetecterQuinte(request, env);
    }

    if (url.pathname === "/api/admin/performance-ia") {
      return handleAdminPerformanceIA(request, env);
    }

    if (url.pathname === "/api/admin/pregenerer" && request.method === "POST") {
      return handleAdminPregen(request, env);
    }

    if (url.pathname === "/api/admin/archive-historique") {
      return handleAdminArchive(request, env);
    }

    if (url.pathname === "/api/admin/stats-visites") {
      return handleAdminStatsVisites(request, env);
    }

    if (url.pathname === "/api/push/subscribe" && request.method === "POST") {
      return handlePushSubscribe(request, env);
    }

    if (url.pathname === "/api/push/unsubscribe" && request.method === "POST") {
      return handlePushUnsubscribe(request, env);
    }

    // Suivi de fréquentation : uniquement les pages publiques réellement consultées
    // (ni l'API, ni les assets statiques, ni l'espace admin).
    const PAGES_SUIVIES = new Set(["/", "/index.html", "/blog.html", "/article.html", "/cgu.html", "/confidentialite.html"]);
    if (request.method === "GET" && PAGES_SUIVIES.has(url.pathname)) {
      ctx.waitUntil(enregistrerVisite(request, env, url.pathname));
    }

    // Toute autre requête : on sert le site statique (dossier public/)
    return env.ASSETS.fetch(request);
  },

  // Deux crons quotidiens (voir wrangler.jsonc) :
  // - 1h : tâches de fond existantes (abonnements, rappels, vérification nocturne)
  // - 6h : notification push "pronostic du jour"
  async scheduled(event, env, ctx) {
    if (event.cron === "0 6 * * *") {
      ctx.waitUntil(envoyerNotificationPronosticDuJour(env));
      return;
    }
    // Archivage de TOUTES les courses (aujourd'hui, hier, puis rattrapage de l'historique).
    if (event.cron === CRON_ARCHIVE) {
      ctx.waitUntil(archiverHistoriqueCourses(env));
      return;
    }
    // Pré-génération de l'analyse de la Course du jour (voir PREGEN_* plus haut).
    if (event.cron === CRON_PREGEN) {
      ctx.waitUntil(pregenererCourseDuJour(env).catch((e) => console.error("[pregen]", e.message)));
      return;
    }
    ctx.waitUntil(expirerAbonnements(env));
    ctx.waitUntil(verifierPredictionsEnAttente(env));
  },
};
