// functions/api/courses-du-jour.js
// Cloudflare Pages Function — appelée sur GET /api/courses-du-jour
// Nécessite un binding KV nommé CACHE_KV (voir wrangler.toml)

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

function formatHeure(heureDepart) {
  try {
    return new Date(heureDepart).toISOString().slice(11, 16);
  } catch {
    return "";
  }
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

export async function onRequestGet(context) {
  const { env } = context;
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  // 1. Lecture du cache KV (clé unique + timestamp stocké dans la valeur)
  const cached = await env.CACHE_KV.get(CACHE_KEY, { type: "json" });
  const now = Date.now();

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return new Response(
      JSON.stringify({ source: "cache", updatedAt: cached.fetchedAt, courses: cached.courses }),
      { headers: corsHeaders }
    );
  }

  // 2. Cache expiré ou absent : on interroge le PMU
  try {
    const courses = await loadCoursesDuJour();
    const payload = { courses, fetchedAt: now };
    // TTL Cloudflare KV en secondes (mini 60s)
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
