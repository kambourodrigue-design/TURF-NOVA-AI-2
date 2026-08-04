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

// --- Pronostics IA (Gemini + Groq) ---

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

D'après la forme, les cotes et les jockeys, donne ton pronostic.
Réponds UNIQUEMENT avec un objet JSON strict, sans texte ni markdown autour, exactement sous cette forme :
{"numero": <numéro du cheval favori>, "cheval": "<nom du cheval>", "confiance": <entier entre 0 et 100>}`;
}

function parseAIJSON(text) {
  try {
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const obj = JSON.parse(cleaned);
    if (obj && obj.numero != null && obj.cheval && obj.confiance != null) {
      return {
        numero: obj.numero,
        cheval: String(obj.cheval),
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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini a répondu ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const parsed = parseAIJSON(text);
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
  const parsed = parseAIJSON(text);
  return parsed ? { ...parsed, source: "Groq" } : null;
}

// Combine les avis des IA : si elles désignent le même cheval, la confiance
// est renforcée ; sinon on retient l'avis le plus confiant, en gardant trace du désaccord.
function combinerPronostics(predictions) {
  const valid = predictions.filter(Boolean);
  if (valid.length === 0) return null;

  const groupes = {};
  for (const p of valid) {
    const key = String(p.numero);
    if (!groupes[key]) groupes[key] = [];
    groupes[key].push(p);
  }

  let meilleur = null;
  for (const key in groupes) {
    const g = groupes[key];
    const confianceMoyenne = g.reduce((s, p) => s + p.confiance, 0) / g.length;
    const bonusAccord = g.length > 1 ? 1.15 : 1;
    const score = confianceMoyenne * bonusAccord;
    if (!meilleur || score > meilleur.score) {
      meilleur = {
        numero: g[0].numero,
        cheval: g[0].cheval,
        confiance: Math.min(99, Math.round(confianceMoyenne * bonusAccord)),
        accordIA: g.length,
        score,
      };
    }
  }

  delete meilleur.score;
  return { ...meilleur, sources: valid.map((p) => p.source) };
}

async function handlePronosticIA(request, env) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };
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

  const consensus = combinerPronostics(predictions);
  if (!consensus) {
    return new Response(
      JSON.stringify({ error: "Aucune prédiction IA disponible", details: erreurs }),
      { status: 502, headers: corsHeaders }
    );
  }

  const payload = { consensus, predictions, updatedAt: Date.now() };
  await env.CACHE_KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: 900 });

  return new Response(JSON.stringify({ source: "live", ...payload }), { headers: corsHeaders });
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

    // Toute autre requête : on sert le site statique (dossier public/)
    return env.ASSETS.fetch(request);
  },
};
