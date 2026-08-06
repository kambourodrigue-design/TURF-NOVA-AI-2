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
// On construit le podium (1er, 2e, 3e) à partir de ce champ.
async function getArrivee(date, numReunion, numCourse) {
  try {
    const data = await fetchJSON(
      `${PMU_BASE}/programme/${date}/R${numReunion}/C${numCourse}/participants`
    );
    const participants = data.participants || [];
    const arrives = participants.filter((p) => p.ordreArrivee != null && p.ordreArrivee > 0);
    if (arrives.length === 0) return null;

    arrives.sort((a, b) => a.ordreArrivee - b.ordreArrivee);
    return arrives.slice(0, 4).map((p) => ({
      position: p.ordreArrivee,
      numero: p.numPmu,
      nom: p.nom,
    }));
  } catch {
    return null;
  }
}

const RESULTATS_CACHE_KEY = "resultats-du-jour";
const RESULTATS_TTL_MS = 60_000;

async function verifierPrediction(env, date, reunion, course, podium) {
  if (!env.DB) return;
  try {
    const pred = await env.DB.prepare(
      `SELECT id, quarte6, coups_surs FROM predictions WHERE date = ? AND reunion = ? AND course = ?`
    )
      .bind(date, reunion, course)
      .first();
    if (!pred) return;

    const dejaVerifie = await env.DB.prepare(
      `SELECT prediction_id FROM resultats_verifies WHERE prediction_id = ?`
    )
      .bind(pred.id)
      .first();
    if (dejaVerifie) return;

    const podiumNumeros = podium.map((p) => p.numero);
    const quarte6 = JSON.parse(pred.quarte6);
    const coupsSurs = JSON.parse(pred.coups_surs || "[]");

    const chevauxCorrects = quarte6.filter((h) => podiumNumeros.includes(h.numero)).length;
    const coupsSursReussis = coupsSurs.filter((numero) => podiumNumeros.includes(numero)).length;

    await env.DB.prepare(
      `INSERT INTO resultats_verifies (prediction_id, podium_reel, chevaux_corrects, coups_surs_reussis, verified_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(pred.id, JSON.stringify(podium), chevauxCorrects, coupsSursReussis, Date.now())
      .run();
  } catch {
    // Vérification best-effort, ne casse jamais l'affichage des résultats
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

      resultats.push({
        reunion: reunionCode,
        course: courseCode,
        hippodrome,
        heure: formatHeure(course.heureDepart),
        podium,
      });

      await verifierPrediction(env, date, reunionCode, courseCode, podium);
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

// --- Pronostics IA (Gemini + Groq) — Quarté en 6 chevaux + 2 coups sûrs ---

function buildPrompt(participants, courseInfo) {
  const liste = participants
    .filter((p) => !p.nonPartant)
    .map((p) => {
      const cote = p.dernierRapportDirect?.rapport;
      const jockey = p.driver?.nom || p.entraineur?.nom || "inconnu";
      return `N°${p.numPmu} ${p.nom} — jockey ${jockey} — cote ${cote ?? "non cotée"}`;
    })
    .join("\n");

  return `Tu es un expert en pronostics hippiques. Voici une course :
Hippodrome : ${courseInfo.hippodrome || "inconnu"}
Discipline : ${courseInfo.discipline || "inconnue"}
Partants :
${liste}

Donne un pronostic pour le Quarté en 6 chevaux : sélectionne 6 chevaux qui couvrent au mieux tes chances sur les 4 premières places, classés du plus probable au moins probable. Parmi ces 6, désigne 2 "coups sûrs" — les 2 chevaux dont tu es le plus confiant qu'ils termineront bien placés.

Réponds UNIQUEMENT avec un objet JSON strict, sans texte ni markdown autour, exactement sous cette forme :
{"quarte6": [{"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}], "coupsSurs": [numero1, numero2], "confiance": <entier entre 0 et 100>}`;
}

function parseQuarteJSON(text) {
  try {
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const obj = JSON.parse(cleaned);
    if (obj && Array.isArray(obj.quarte6) && obj.quarte6.length >= 4 && obj.confiance != null) {
      return {
        quarte6: obj.quarte6.slice(0, 6).map((c) => ({ numero: c.numero, cheval: String(c.cheval) })),
        coupsSurs: Array.isArray(obj.coupsSurs) ? obj.coupsSurs.slice(0, 2) : [],
        confiance: Math.max(0, Math.min(100, Math.round(obj.confiance))),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function callGemini(prompt, apiKey) {
  if (!apiKey) return null;
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
  return parsed ? { ...parsed, source: "Gemini" } : null;
}

async function callGroq(prompt, apiKey) {
  if (!apiKey) return null;
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
  if (!res.ok) throw new Error(`Groq a répondu ${res.status}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const parsed = parseQuarteJSON(text);
  return parsed ? { ...parsed, source: "Groq" } : null;
}

async function callDeepSeek(prompt, apiKey) {
  if (!apiKey) return null;
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`DeepSeek a répondu ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const parsed = parseQuarteJSON(text);
  return parsed ? { ...parsed, source: "DeepSeek" } : null;
}

// Combine les avis des IA : chaque cheval marque des points selon sa position
// dans le classement de chaque IA (6 pts pour le 1er choix, 1 pt pour le 6e).
// Les "coups sûrs" désignés par les deux IA remontent en tête.
function combinerQuarte6(predictions) {
  const valid = predictions.filter(Boolean);
  if (valid.length === 0) return null;

  const scores = {};
  const coupSurVotes = {};

  for (const p of valid) {
    p.quarte6.forEach((cheval, idx) => {
      const pts = 6 - idx;
      const key = String(cheval.numero);
      if (!scores[key]) scores[key] = { numero: cheval.numero, nom: cheval.cheval, score: 0 };
      scores[key].score += pts;
    });
    (p.coupsSurs || []).forEach((numero) => {
      const key = String(numero);
      coupSurVotes[key] = (coupSurVotes[key] || 0) + 1;
      if (scores[key]) scores[key].score += 3;
    });
  }

  const classement = Object.values(scores)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const coupsSurs = classement
    .map((c) => ({ ...c, votes: coupSurVotes[String(c.numero)] || 0 }))
    .sort((a, b) => b.votes - a.votes || b.score - a.score)
    .slice(0, 2)
    .map((c) => c.numero);

  const confianceMoyenne = Math.round(valid.reduce((s, p) => s + p.confiance, 0) / valid.length);
  const bonusAccord = valid.length > 1 ? (valid.length - 1) * 4 : 0;

  return {
    quarte6: classement.map((c, i) => ({
      position: i + 1,
      numero: c.numero,
      cheval: c.nom,
      coupSur: coupsSurs.includes(c.numero),
    })),
    confiance: Math.min(99, confianceMoyenne + bonusAccord),
    sources: valid.map((p) => p.source),
  };
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
  const cacheKey = `pronostic:${date}:${reunion}:${course}`;
  const cached = await env.CACHE_KV.get(cacheKey, { type: "json" });
  if (cached) {
    return new Response(JSON.stringify({ source: "cache", ...cached }), { headers: corsHeaders });
  }

  let participants = [];
  let courseInfo = {};
  try {
    const data = await fetchJSON(`${PMU_BASE}/programme/${date}/${reunion}/${course}/participants`);
    participants = data.participants || [];
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Impossible de récupérer les partants", details: e.message }),
      { status: 502, headers: corsHeaders }
    );
  }

  const prompt = buildPrompt(participants, courseInfo);

  const results = await Promise.allSettled([
    callGemini(prompt, env.GEMINI_API_KEY),
    callGroq(prompt, env.GROQ_API_KEY),
    callDeepSeek(prompt, env.DEEPSEEK_API_KEY),
  ]);

  const predictions = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .filter(Boolean);

  const erreurs = results.filter((r) => r.status === "rejected").map((r) => r.reason?.message);

  const consensus = combinerQuarte6(predictions);
  if (!consensus) {
    return new Response(
      JSON.stringify({ error: "Aucune prédiction IA disponible", details: erreurs }),
      { status: 502, headers: corsHeaders }
    );
  }

  const payload = { consensus, predictions, erreurs, updatedAt: Date.now() };
  await env.CACHE_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 900 });

  if (env.DB) {
    try {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO predictions (date, reunion, course, hippodrome, quarte6, coups_surs, confiance, sources, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          date,
          reunion,
          course,
          "",
          JSON.stringify(consensus.quarte6),
          JSON.stringify(consensus.quarte6.filter((h) => h.coupSur).map((h) => h.numero)),
          consensus.confiance,
          JSON.stringify(consensus.sources),
          Date.now()
        )
        .run();
    } catch (e) {
      // On n'échoue jamais la réponse à cause d'un souci d'enregistrement stats
    }
  }

  return new Response(JSON.stringify({ source: "live", ...payload }), { headers: corsHeaders });
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

async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies["session"];
  if (!token) return null;
  const email = await env.CACHE_KV.get(`session:${token}`);
  if (!email) return null;

  // Un compte désactivé par l'admin perd immédiatement l'accès, même avec une session valide.
  const user = await env.CACHE_KV.get(`user:${email}`, { type: "json" });
  if (user && user.actif === false) {
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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.CACHE_KV.put(`session:${token}`, email, { expirationTtl: SESSION_TTL_SECONDS });

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

  const stored = await env.CACHE_KV.get(`user:${email}`, { type: "json" });
  if (!stored) {
    return new Response(JSON.stringify({ error: "Email ou mot de passe incorrect" }), { status: 401, headers: corsHeaders });
  }

  const { hash } = await hashPassword(password, stored.salt);
  if (hash !== stored.hash) {
    return new Response(JSON.stringify({ error: "Email ou mot de passe incorrect" }), { status: 401, headers: corsHeaders });
  }

  if (stored.actif === false) {
    return new Response(
      JSON.stringify({ error: "Ce compte a été désactivé. Contacte le support si tu penses que c'est une erreur." }),
      { status: 403, headers: corsHeaders }
    );
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.CACHE_KV.put(`session:${token}`, email, { expirationTtl: SESSION_TTL_SECONDS });

  return new Response(JSON.stringify({ ok: true, email }), {
    status: 200,
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
  return new Response(JSON.stringify({ authenticated: !!email, email: email || null }), { headers: corsHeaders });
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
              AVG(chevaux_corrects) as moyenne_chevaux_corrects
       FROM resultats_verifies`
    ).first();

    const total = global?.total || 0;
    const tauxCoupSur = total > 0 ? Math.round((global.au_moins_un_coup_sur / total) * 100) : null;
    const tauxDoubleCoupSur = total > 0 ? Math.round((global.deux_coups_surs / total) * 100) : null;

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
        moyenneChevauxCorrectsSur6: global?.moyenne_chevaux_corrects ? Math.round(global.moyenne_chevaux_corrects * 10) / 10 : null,
        dernieresVerifications: recentes.results || [],
      }),
      { headers: corsHeaders }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: "Erreur base de données", details: e.message }), { status: 500, headers: corsHeaders });
  }
}

// --- Abonnements (sans paiement réel pour l'instant — statut géré manuellement) ---

const PLANS_VALIDES = ["gratuit", "turfiste", "prestige"];

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
  return new Response(JSON.stringify(sub), { headers: corsHeaders });
}

// Choix instantané du plan gratuit uniquement — les plans payants sont payés via un lien
// MoneyFusion et activés manuellement par l'admin (voir /api/admin/abonnement/statut).
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

// --- Espace administrateur (protégé par ADMIN_EMAIL) ---

async function requireAdmin(request, env) {
  const email = await getSessionUser(request, env);
  if (!email || !env.ADMIN_EMAIL || email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
    return null;
  }
  return email;
}

// Liste tous les comptes inscrits (KV) avec leur statut d'abonnement (D1, s'il existe).
async function handleAdminUtilisateurs(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const admin = await requireAdmin(request, env);
  if (!admin) {
    return new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403, headers: corsHeaders });
  }

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

  return new Response(JSON.stringify({ utilisateurs }), { headers: corsHeaders });
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
  const expiresAt = plan === "gratuit" ? null : now + 30 * 24 * 60 * 60 * 1000;

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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/courses-du-jour") {
      return handleCoursesDuJour(env);
    }

    if (url.pathname === "/api/pronostic-ia") {
      return handlePronosticIA(request, env);
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

    if (url.pathname === "/api/admin/utilisateurs") {
      return handleAdminUtilisateurs(request, env);
    }

    if (url.pathname === "/api/admin/compte/statut" && request.method === "POST") {
      return handleAdminCompteStatut(request, env);
    }

    if (url.pathname === "/api/admin/abonnement/statut" && request.method === "POST") {
      return handleAdminAbonnementStatut(request, env);
    }

    // Toute autre requête : on sert le site statique (dossier public/)
    return env.ASSETS.fetch(request);
  },
};
