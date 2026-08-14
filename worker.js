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
    return {
      hippodrome: reunion.hippodrome?.libelleCourt || reunion.libelleCourt || "",
      discipline: course?.discipline || course?.specialite || "",
      distance: course?.distance || null,
    };
  } catch {
    return {};
  }
}

// --- Pronostics IA (4 modèles combinés) — Quarté en 8 chevaux + 2 coups sûrs ---

function buildPrompt(participants, courseInfo) {
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
      const details = [sexe, age, corde, poids, oeilleres, gains].filter(Boolean).join(", ");
      return `N°${p.numPmu} ${p.nom} — jockey/driver ${jockey} — cote ${cote ?? "non cotée"} — musique: ${musique}${details ? " — " + details : ""}`;
    })
    .join("\n");

  return `Tu es un pronostiqueur hippique professionnel. Cette course a pour discipline brute (telle que fournie par l'API) : "${courseInfo.discipline || "inconnue"}".

Commence par identifier à quelle famille appartient cette discipline, puis applique UNIQUEMENT la grille de pondération correspondante :

— Si PLAT (galop plat, y compris handicap plat) :
  Forme récente (musique) : 35% | Poids porté : 20% | Position à la corde : 15% | Driver/jockey et entraîneur : 15% | Aptitude distance/piste : 10% | Valeur (cote vs niveau réel) : 5%
  Note : la corde compte particulièrement sur les hippodromes à virage serré et les courses courtes. Le poids porté est souvent déterminant en handicap.

— Si TROT (attelé ou monté) :
  Forme récente (musique) : 35% | Driver/jockey : 30% | Aptitude distance/discipline : 15% | Place au départ/corde : 10% | Valeur : 10%
  Note : en trot, le poids porté n'est quasiment jamais un critère de sélection pertinent — ignore-le. Le driver pèse presque autant que la forme, car il gère l'allure et évite les disqualifications (écarts, galops). Pénalise fortement une musique récente indiquant des disqualifications.

— Si OBSTACLE (haies, steeple-chase, cross) :
  Forme + expérience à l'obstacle : 40% | Poids porté : 20% | Jockey (expérience obstacles) : 20% | Aptitude distance/terrain : 15% | Valeur : 5%
  Note : priorité absolue à l'expérience aux obstacles. Dans la musique, repère les lettres indiquant une chute ou un tombé (ex. "t", "Tb") lors des dernières courses et pénalise très fortement un cheval qui est tombé récemment, même si le reste de sa forme est bon.

Si la discipline ne correspond clairement à aucune des trois familles ci-dessus, utilise par défaut la grille PLAT.

Hippodrome : ${courseInfo.hippodrome || "inconnu"}
Distance : ${courseInfo.distance ? courseInfo.distance + " m" : "inconnue"}

Partants (musique = perfs récentes, la plus récente en premier ; ex "1a2a3a" = 1er, 2e, 3e) :
${liste}

Étapes obligatoires avant de répondre :
1. Annonce-toi (en interne, sans l'afficher) la famille de discipline retenue et la grille choisie.
2. Pour chaque cheval, évalue mentalement les critères de cette grille (ne les affiche pas).
3. Élimine ou pénalise fortement les chevaux avec musique dégradée, chute/tombé récent (obstacle), position défavorable pour la discipline concernée, ou incohérence forme/cote flagrante.
4. Reste vigilant : ne suis pas aveuglément le favori si sa forme récente ou ses critères clés sont mauvais — signale les "pièges" potentiels via une confiance globale plus basse.
5. Classe ensuite les 8 meilleurs chevaux du plus probable au moins probable pour une place dans les 4 premiers.
6. Parmi ces 8, désigne 2 "coups sûrs" : uniquement des chevaux qui cumulent la majorité des critères favorables de la grille retenue, pas seulement la cote la plus basse.

Réponds UNIQUEMENT avec un objet JSON strict, sans texte ni markdown autour, exactement sous cette forme :
{"quarte8": [{"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}, {"numero": N, "cheval": "Nom"}], "coupsSurs": [numero1, numero2], "confiance": <entier entre 0 et 100, reflète honnêtement l'incertitude réelle de la course>}`;
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
        quarte8: obj.quarte8.slice(0, 8).map((c) => ({ numero: c.numero, cheval: String(c.cheval) })),
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

async function callDeepSeek(prompt, apiKey) {
  if (!apiKey) throw new Error("Clé API manquante");
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
  if (!parsed) throw new Error("Réponse DeepSeek non conforme (JSON illisible)");
  return { ...parsed, source: "DeepSeek" };
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
      max_tokens: 1500,
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
      model: "deepseek-chat",
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
    blocCourseDuJour = `\n\nCourse du jour mise en avant (${courseDuJour.reunion} ${courseDuJour.course}, ${courseDuJour.hippodrome}) — pronostic Quarté en 8 de nos IA, confiance ${courseDuJour.confiance}% : ${chevaux}`;
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
    courseDuJour = await env.CACHE_KV.get(`course-du-jour-full:${date}:${reunion}:${course}`, { type: "json" });
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
    .slice(0, 8);

  const coupsSurs = classement
    .map((c) => ({ ...c, votes: coupSurVotes[String(c.numero)] || 0 }))
    .sort((a, b) => b.votes - a.votes || b.score - a.score)
    .slice(0, 2)
    .map((c) => c.numero);

  const confianceMoyenne = Math.round(valid.reduce((s, p) => s + p.confiance, 0) / valid.length);
  const bonusAccord = valid.length > 1 ? (valid.length - 1) * 4 : 0;

  return {
    quarte8: classement.map((c, i) => ({
      position: i + 1,
      numero: c.numero,
      cheval: c.nom,
      coupSur: coupsSurs.includes(c.numero),
    })),
    confiance: Math.min(99, confianceMoyenne + bonusAccord),
    sources: valid.map((p) => p.source), // interne uniquement — jamais exposé au client
  };
}

// Calcule (ou lit en cache) le consensus IA pour une course donnée.
// Partagée entre le pronostic à la demande (handlePronosticIA) et le calcul
// du "Top courses du jour" — pour ne jamais payer deux fois l'appel aux 4 IA
// pour la même course dans la même fenêtre de cache.
async function obtenirPronosticConsensus(date, reunion, course, env) {
  const cacheKey = `pronostic:${date}:${reunion}:${course}`;
  const cached = await env.CACHE_KV.get(cacheKey, { type: "json" });
  if (cached) {
    return { consensus: cached.consensus, updatedAt: cached.updatedAt, source: "cache" };
  }

  const [data, courseInfo] = await Promise.all([
    fetchJSON(`${PMU_BASE}/programme/${date}/${reunion}/${course}/participants`),
    getCourseInfo(date, reunion, course),
  ]);
  const participants = data.participants || [];

  const prompt = buildPrompt(participants, courseInfo);

  const results = await Promise.allSettled([
    callGemini(prompt, env.GEMINI_API_KEY),
    callGroq(prompt, env.GROQ_API_KEY),
    callDeepSeek(prompt, env.DEEPSEEK_API_KEY),
    callClaude(prompt, env.ANTHROPIC_API_KEY),
  ]);

  const predictions = results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value)
    .filter(Boolean);

  const consensus = combinerQuarte8(predictions);
  if (!consensus) return { consensus: null, updatedAt: null, source: "live" };

  const updatedAt = Date.now();
  await env.CACHE_KV.put(cacheKey, JSON.stringify({ consensus, updatedAt }), { expirationTtl: 900 });

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
          courseInfo.hippodrome || "",
          JSON.stringify(consensus.quarte8),
          JSON.stringify(consensus.quarte8.filter((h) => h.coupSur).map((h) => h.numero)),
          consensus.confiance,
          JSON.stringify(consensus.sources),
          updatedAt
        )
        .run();
    } catch (e) {
      // On n'échoue jamais la réponse à cause d'un souci d'enregistrement stats
    }
  }

  return { consensus, updatedAt, source: "live" };
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
        message: acces.essaiExpire
          ? "Ton essai gratuit de 4 jours est terminé — choisis un plan pour continuer à voir les pronostics IA."
          : "Un abonnement actif (essai ou Prestige) est nécessaire pour voir les pronostics IA.",
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
  let resultat;
  try {
    resultat = await obtenirPronosticConsensus(date, reunion, course, env);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Impossible de récupérer les partants", details: e.message }),
      { status: 502, headers: corsHeaders }
    );
  }

  if (!resultat.consensus) {
    return new Response(
      JSON.stringify({ error: "Aucune prédiction IA disponible" }),
      { status: 502, headers: corsHeaders }
    );
  }

  const { sources, ...consensusPublic } = resultat.consensus;
  return new Response(
    JSON.stringify({ source: resultat.source, consensus: consensusPublic, updatedAt: resultat.updatedAt }),
    { headers: corsHeaders }
  );
}

async function calculerTopCoursesDuJour(env) {
  const date = todayParam();
  const programme = await fetchJSON(`${PMU_BASE}/programme/${date}`);
  const reunions = programme.programme?.reunions || [];
  const now = Date.now();

  // On ne retient que les courses pas encore parties (un pronostic sur une
  // course déjà courue n'a plus d'intérêt), triées par heure de départ.
  const aVenir = [];
  for (const reunion of reunions) {
    const numReunion = reunion.numOfficiel ?? reunion.numExterne;
    const hippodrome = reunion.hippodrome?.libelleCourt || reunion.libelleCourt || "";
    for (const course of reunion.courses || []) {
      const heureDepartMs = course.heureDepart;
      if (!heureDepartMs || heureDepartMs <= now) continue;
      aVenir.push({
        reunion: `R${numReunion}`,
        course: `C${course.numOrdre ?? course.numExterne}`,
        hippodrome,
        heure: formatHeure(heureDepartMs),
        heureDepartMs,
        discipline: course.discipline || course.specialite || "",
        distance: course.distance || null,
      });
    }
  }
  aVenir.sort((a, b) => a.heureDepartMs - b.heureDepartMs);

  // Plafond de 25 courses analysées pour borner le nombre d'appels aux 4 IA
  // (les courses les plus proches dans le temps sont prioritaires).
  const pool = aVenir.slice(0, 25);

  const analyses = await Promise.allSettled(
    pool.map((c) => obtenirPronosticConsensus(date, c.reunion, c.course, env))
  );

  const top = pool
    .map((c, i) => {
      const r = analyses[i];
      if (r.status !== "fulfilled" || !r.value.consensus) return null;
      return { ...c, confiance: r.value.consensus.confiance };
    })
    .filter((c) => c && c.confiance >= 70)
    .sort((a, b) => b.confiance - a.confiance || a.heureDepartMs - b.heureDepartMs)
    .slice(0, 4)
    .map(({ heureDepartMs, ...c }) => c);

  return top;
}

async function handleTopCoursesDuJour(env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const date = todayParam();
  const cacheKey = `top-courses:${date}`;
  const cached = await env.CACHE_KV.get(cacheKey, { type: "json" });
  if (cached) {
    return new Response(JSON.stringify({ source: "cache", courses: cached.courses, updatedAt: cached.updatedAt }), {
      headers: corsHeaders,
    });
  }

  try {
    const courses = await calculerTopCoursesDuJour(env);
    const updatedAt = Date.now();
    await env.CACHE_KV.put(cacheKey, JSON.stringify({ courses, updatedAt }), { expirationTtl: 900 });
    return new Response(JSON.stringify({ source: "live", courses, updatedAt }), { headers: corsHeaders });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Impossible de calculer le top des courses", details: e.message }),
      { status: 502, headers: corsHeaders }
    );
  }
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

  // Essai gratuit de 4 jours à l'inscription — limité à 1 essai par adresse IP
  // (une IP change à chaque reconnexion mobile, donc ce n'est qu'un frein souple).
  if (env.DB) {
    try {
      const ip = request.headers.get("CF-Connecting-IP") || "inconnue";
      const ipDejaUtilisee = await env.CACHE_KV.get(`essai_ip:${ip}`);
      const now = Date.now();

      if (ipDejaUtilisee) {
        await env.DB.prepare(
          `INSERT INTO subscriptions (email, plan, status, started_at, expires_at)
           VALUES (?, 'gratuit', 'active', ?, NULL)
           ON CONFLICT(email) DO NOTHING`
        ).bind(email, now).run();
      } else {
        const expiresAt = now + 4 * 24 * 60 * 60 * 1000;
        await env.DB.prepare(
          `INSERT INTO subscriptions (email, plan, status, started_at, expires_at)
           VALUES (?, 'essai', 'active', ?, ?)
           ON CONFLICT(email) DO NOTHING`
        ).bind(email, now, expiresAt).run();
        // Mémorisé 90 jours : passé ce délai, la même IP peut redéclencher un essai
        // (évite de pénaliser définitivement un foyer/box internet partagé).
        await env.CACHE_KV.put(`essai_ip:${ip}`, email, { expirationTtl: 90 * 24 * 60 * 60 });
      }
    } catch {
      // L'inscription ne doit jamais échouer à cause d'un souci sur l'essai gratuit
    }
  }

  const token = crypto.randomUUID() + crypto.randomUUID();
  await env.CACHE_KV.put(`session:${token}`, email, { expirationTtl: SESSION_TTL_SECONDS });

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
              SUM(CASE WHEN chevaux_corrects = 4 THEN 1 ELSE 0 END) as quarte_reussi,
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

function emailShell(titre, corps) {
  return `
    <div style="font-family:Arial,sans-serif; background:#0c0c0d; padding:32px 0;">
      <div style="max-width:480px; margin:0 auto; background:#1c1c1f; border:1px solid #c9a227; border-radius:8px; overflow:hidden;">
        <div style="background:#000; padding:20px 28px;">
          <span style="font-family:Georgia,serif; font-size:20px; font-weight:bold; color:#fff; letter-spacing:1px;">TURF NOVA AI<span style="color:#c9a227;">.</span></span>
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
    `<p style="font-size:14px; line-height:1.6;">Ton compte est créé et ton essai gratuit de <b>4 jours</b> a commencé — tu as dès maintenant accès aux pronostics IA (Quarté en 8 + coups sûrs) sur toutes les courses du jour.</p>
     <p style="font-size:14px; line-height:1.6;">Profites-en pour tester le modèle sur quelques courses avant la fin de ton essai.</p>
     <a href="https://${env.SITE_DOMAIN || "turf-nova-ai.com"}" style="display:inline-block; margin-top:12px; background:#c9a227; color:#0c0c0d; padding:11px 22px; border-radius:4px; text-decoration:none; font-weight:bold; font-size:13px;">Voir les pronostics du jour</a>`
  );
  await envoyerEmail(env, { to: email, subject: "Bienvenue sur Turf Nova AI — ton essai a commencé", html });
}

async function envoyerEmailRappelEssai(env, email, heuresRestantes) {
  const html = emailShell(
    "Ton essai gratuit se termine bientôt ⏳",
    `<p style="font-size:14px; line-height:1.6;">Il te reste environ <b>${heuresRestantes} heures</b> d'accès gratuit aux pronostics IA de Turf Nova AI.</p>
     <p style="font-size:14px; line-height:1.6;">Passe au plan Prestige pour continuer à voir le Quarté en 8 et les coups sûrs sans interruption.</p>
     <a href="https://${env.SITE_DOMAIN || "turf-nova-ai.com"}/#abonnements" style="display:inline-block; margin-top:12px; background:#c9a227; color:#0c0c0d; padding:11px 22px; border-radius:4px; text-decoration:none; font-weight:bold; font-size:13px;">Passer à Prestige</a>`
  );
  await envoyerEmail(env, { to: email, subject: "Ton essai Turf Nova AI se termine bientôt", html });
}

async function envoyerEmailPaiementConfirme(env, email, plan) {
  const html = emailShell(
    "Paiement confirmé ✓",
    `<p style="font-size:14px; line-height:1.6;">Ton abonnement <b>${plan}</b> est actif. Merci pour ta confiance !</p>
     <p style="font-size:14px; line-height:1.6;">Tu as désormais un accès complet aux pronostics IA sur toutes les courses, sans limite.</p>
     <a href="https://${env.SITE_DOMAIN || "turf-nova-ai.com"}" style="display:inline-block; margin-top:12px; background:#c9a227; color:#0c0c0d; padding:11px 22px; border-radius:4px; text-decoration:none; font-weight:bold; font-size:13px;">Accéder au site</a>`
  );
  await envoyerEmail(env, { to: email, subject: "Ton abonnement Turf Nova AI est actif", html });
}

const PLANS_VALIDES = ["gratuit", "essai", "prestige", "quinzaine"];

// Détermine si un compte a un accès premium actif (essai en cours, ou plan payant).
async function verifierAccesPremium(env, email) {
  if (!env.DB) return { actif: true, essaiExpire: false }; // pas de restriction si pas de base configurée
  const sub = await env.DB.prepare(`SELECT plan, status, expires_at FROM subscriptions WHERE email = ?`)
    .bind(email)
    .first();

  if (!sub || sub.plan === "gratuit") return { actif: false, essaiExpire: false };
  if (sub.status !== "active") return { actif: false, essaiExpire: sub.plan === "essai" };

  if (sub.plan === "essai" || sub.plan === "prestige") {
    if (sub.expires_at && sub.expires_at < Date.now()) {
      return { actif: false, essaiExpire: sub.plan === "essai" };
    }
    return { actif: true, essaiExpire: false };
  }
  return { actif: false, essaiExpire: false };
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
  return new Response(JSON.stringify(sub), { headers: corsHeaders });
}

// Choix instantané du plan gratuit uniquement — les plans payants sont payés via un lien
// MoneyFusion et activés manuellement par l'admin (voir /api/admin/abonnement/statut).
// --- Paiement Chariow (remplace MoneyFusion) ---
// Nécessite le secret Cloudflare CHARIOW_API_KEY (clé secrète, jamais dans le code).
// Le produit "Abonnement Prestige — 1 mois" doit être créé et publié sur Chariow.

const CHARIOW_API_BASE = "https://api.chariow.com/v1";
const PRODUITS_CHARIOW = {
  prestige: "prd_7w9pduoj",
  // Remplacer par le vrai product_id une fois le produit "Quinzaine" créé sur Chariow.
  quinzaine: "PLACEHOLDER_PRODUCT_ID_QUINZAINE",
};

// Durée d'accès accordée par plan payant, utilisée à l'activation (webhook et activation manuelle admin).
const DUREE_PLAN_MS = {
  prestige: 30 * 24 * 60 * 60 * 1000,
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

  const plan = String(body.plan || "prestige");
  const productId = PRODUITS_CHARIOW[plan];
  if (!productId) {
    return new Response(JSON.stringify({ error: "Plan payant inconnu" }), { status: 400, headers: corsHeaders });
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
    const appPlan = sale.custom_metadata?.app_plan || "prestige";
    if (!appEmail || !env.DB) {
      return new Response("ok", { status: 200 });
    }

    const now = Date.now();
    const dureeMs = DUREE_PLAN_MS[appPlan] || DUREE_PLAN_MS.prestige;

    const existant = await env.DB.prepare(`SELECT expires_at FROM subscriptions WHERE email = ?`).bind(appEmail).first();
    const baseDepart = existant?.expires_at && existant.expires_at > now ? existant.expires_at : now;
    const expiresAt = baseDepart + dureeMs;

    await env.DB.prepare(
      `INSERT INTO subscriptions (email, plan, status, started_at, expires_at)
       VALUES (?, ?, 'active', ?, ?)
       ON CONFLICT(email) DO UPDATE SET plan = excluded.plan, status = 'active', expires_at = excluded.expires_at`
    ).bind(appEmail, appPlan, now, expiresAt).run();

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

// Envoie un rappel par email aux essais qui se terminent dans moins de 24h,
// une seule fois par essai (reminder_sent évite les doublons si le cron tourne plusieurs fois).
async function envoyerRappelsEssai(env) {
  if (!env.DB || !env.RESEND_API_KEY) return;
  try {
    const now = Date.now();
    const dansMoinsDe24h = now + 24 * 60 * 60 * 1000;

    const { results } = await env.DB.prepare(
      `SELECT email, expires_at FROM subscriptions
       WHERE plan = 'essai' AND status = 'active' AND reminder_sent = 0
         AND expires_at IS NOT NULL AND expires_at > ? AND expires_at < ?`
    )
      .bind(now, dansMoinsDe24h)
      .all();

    for (const abonne of results || []) {
      const heuresRestantes = Math.max(1, Math.ceil((abonne.expires_at - now) / (60 * 60 * 1000)));
      await envoyerEmailRappelEssai(env, abonne.email, heuresRestantes);
      await env.DB.prepare(`UPDATE subscriptions SET reminder_sent = 1 WHERE email = ?`).bind(abonne.email).run();
    }
  } catch {
    // On retentera au prochain passage du cron.
  }
}

// --- Course du Jour (Quinté+ commun PMU, mis en avant sur la page d'accueil) ---
// L'admin choisit chaque jour la réunion/course concernée (voir handleAdminCourseDuJour).
// Par défaut R1/C3 si rien n'est configuré.

const COURSE_DU_JOUR_CONFIG_KEY = "course-du-jour-config";
const COURSE_DU_JOUR_TTL_SECONDS = 3 * 60 * 60; // 3h — évite d'appeler les IA à chaque visite

async function getCourseDuJourConfig(env) {
  const config = await env.CACHE_KV.get(COURSE_DU_JOUR_CONFIG_KEY, { type: "json" });
  return config || { reunion: "R1", course: "C3" };
}

async function handleCourseDuJour(request, env) {
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  const date = todayParam();
  const { reunion, course } = await getCourseDuJourConfig(env);
  const cacheKey = `course-du-jour-full:${date}:${reunion}:${course}`;

  let full = await env.CACHE_KV.get(cacheKey, { type: "json" });

  if (!full) {
    try {
      const [courseInfo, participantsData] = await Promise.all([
        getCourseInfo(date, reunion, course),
        fetchJSON(`${PMU_BASE}/programme/${date}/${reunion}/${course}/participants`).catch(() => null),
      ]);

      const participants = participantsData?.participants || [];
      const nbPartants = participants.filter((p) => !p.nonPartant).length || null;

      let quarte8 = null;
      let confiance = null;
      let iaStatus = null;

      if (participants.length) {
        const prompt = buildPrompt(participants, courseInfo);
        const results = await Promise.allSettled([
          callGemini(prompt, env.GEMINI_API_KEY),
          callGroq(prompt, env.GROQ_API_KEY),
          callDeepSeek(prompt, env.DEEPSEEK_API_KEY),
          callClaude(prompt, env.ANTHROPIC_API_KEY),
        ]);
        const noms = ["Gemini", "Groq", "DeepSeek", "Claude"];
        iaStatus = results.map((r, i) => ({
          ia: noms[i],
          ok: r.status === "fulfilled" && !!r.value,
          raison: r.status === "rejected" ? String(r.reason?.message || r.reason || "Erreur inconnue").slice(0, 150) : null,
        }));
        const predictions = results.filter((r) => r.status === "fulfilled").map((r) => r.value).filter(Boolean);
        const consensus = combinerQuarte8(predictions);

        if (consensus && consensus.confiance > 0) {
          quarte8 = consensus.quarte8.map((c) => {
            const p = participants.find((pp) => pp.numPmu === c.numero);
            return {
              position: c.position,
              numero: c.numero,
              cheval: c.cheval,
              coupSur: c.coupSur,
              jockey: p?.driver?.nom || p?.entraineur?.nom || "",
              cote: p?.dernierRapportDirect?.rapport ?? null,
            };
          });
          confiance = consensus.confiance;
        }
      }

      full = {
        reunion,
        course,
        hippodrome: courseInfo.hippodrome || "",
        discipline: courseInfo.discipline || "",
        distance: courseInfo.distance || null,
        partants: nbPartants,
        quarte8,
        confiance,
        iaStatus,
        updatedAt: Date.now(),
      };

      // Pronostic + confiance sont générés ensemble : soit les deux sont présents, soit
      // aucun. Si l'IA n'a pas pu répondre, on ne verrouille pas ce résultat vide 3h :
      // on réessaie dans 5 minutes (le temps que le PMU publie les infos manquantes).
      const resultatComplet = !!quarte8 && !!confiance;
      const ttl = resultatComplet ? COURSE_DU_JOUR_TTL_SECONDS : 5 * 60;
      await env.CACHE_KV.put(cacheKey, JSON.stringify(full), { expirationTtl: ttl });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Impossible de récupérer la course du jour", details: e.message }),
        { status: 502, headers: corsHeaders }
      );
    }
  }

  // Accès complet (8 chevaux + coups sûrs) réservé aux comptes avec abonnement actif.
  // Sans abonnement : aperçu des 3 premiers chevaux seulement, le reste est verrouillé.
  const email = await getSessionUser(request, env);
  const acces = email ? await verifierAccesPremium(env, email) : { actif: false };

  const base = {
    reunion: full.reunion,
    course: full.course,
    hippodrome: full.hippodrome,
    discipline: full.discipline,
    distance: full.distance,
    partants: full.partants,
    confiance: full.confiance,
    updatedAt: full.updatedAt,
  };

  if (!full.quarte8) {
    return new Response(JSON.stringify({ ...base, quarte8: null, verrouille: false }), { headers: corsHeaders });
  }

  if (acces.actif) {
    return new Response(
      JSON.stringify({ ...base, quarte8: full.quarte8, verrouille: false }),
      { headers: corsHeaders }
    );
  }

  const apercu = full.quarte8.slice(0, 3);
  return new Response(
    JSON.stringify({
      ...base,
      quarte8: apercu,
      verrouille: true,
      totalChevaux: full.quarte8.length,
      chevauxCaches: full.quarte8.length - apercu.length,
    }),
    { headers: corsHeaders }
  );
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
        `course-du-jour-full:${date}:${config.reunion}:${config.course}`,
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

  const reunion = String(body.reunion || "").trim().toUpperCase();
  const course = String(body.course || "").trim().toUpperCase();

  if (!/^R\d+$/.test(reunion) || !/^C\d+$/.test(course)) {
    return new Response(
      JSON.stringify({ error: "Format invalide — attendu ex: reunion='R1', course='C3'" }),
      { status: 400, headers: corsHeaders }
    );
  }

  await env.CACHE_KV.put(COURSE_DU_JOUR_CONFIG_KEY, JSON.stringify({ reunion, course }));

  // On efface le cache du jour pour que le changement soit visible immédiatement.
  const date = todayParam();
  await env.CACHE_KV.delete(`course-du-jour-full:${date}:${reunion}:${course}`);

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
  const image = article.image_url || `https://${domaine}/favicon.svg`;
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

    if (url.pathname === "/api/top-courses-jour") {
      return handleTopCoursesDuJour(env);
    }

    if (url.pathname === "/api/admin/course-du-jour") {
      return handleAdminCourseDuJour(request, env);
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

    if (url.pathname === "/api/admin/compte/statut" && request.method === "POST") {
      return handleAdminCompteStatut(request, env);
    }

    if (url.pathname === "/api/admin/abonnement/statut" && request.method === "POST") {
      return handleAdminAbonnementStatut(request, env);
    }

    if (url.pathname === "/api/admin/stats-visites") {
      return handleAdminStatsVisites(request, env);
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

  // Cron quotidien (voir wrangler.jsonc) : rétrograde les abonnements expirés + rappels d'essai.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(expirerAbonnements(env));
    ctx.waitUntil(envoyerRappelsEssai(env));
  },
};
