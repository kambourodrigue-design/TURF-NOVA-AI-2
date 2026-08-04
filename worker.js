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
    return arrives.slice(0, 3).map((p) => ({
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

async function loadResultatsDuJour() {
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

      resultats.push({
        reunion: `R${numReunion}`,
        course: `C${numCourse}`,
        hippodrome,
        heure: formatHeure(course.heureDepart),
        podium,
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
    const resultats = await loadResultatsDuJour();
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
  const bonusAccord = valid.length > 1 ? 5 : 0;

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
  return await env.CACHE_KV.get(`session:${token}`);
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
  await env.CACHE_KV.put(`user:${email}`, JSON.stringify({ hash, salt, createdAt: Date.now() }));

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

    // Toute autre requête : on sert le site statique (dossier public/)
    return env.ASSETS.fetch(request);
  },
};
