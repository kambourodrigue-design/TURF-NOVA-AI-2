import React, { useEffect, useState } from 'react';
import { api, PlanSettings, PublicTestimonial } from '../../services/api';
import { Logo } from '../brand/Logo';
import { ThemeToggle } from '../common/ThemeToggle';

const SHOWCASE: [string, string, string, string][] = [
  ['ventes', 'Gestion des ventes', 'Suivez vos ventes en toute simplicité.', 'Commerçante qui suit ses ventes sur son téléphone avec Nafora'],
  ['stocks', 'Gestion des stocks', 'Maîtrisez vos approvisionnements, alertes de stock faible.', 'Deux commerçants qui consultent leur stock sur Nafora'],
  ['creances', 'Créances et dettes fournisseurs', 'Gardez le contrôle des paiements et des échéances.', 'Commerçant qui suit ses créances clients et dettes fournisseurs avec Nafora'],
];

interface Props { onLogin: () => void; onRegister: () => void }

const FEATURES: [string, string, string][] = [
  ['🛒', 'Caisse rapide', 'Encaissez en quelques touches, imprimez ou envoyez le reçu par WhatsApp. Vous pouvez même dicter la vente à la voix.'],
  ['📦', 'Stocks sous contrôle', 'Quantités à jour après chaque vente, alertes de rupture, prix d\'achat et de vente pour connaître votre marge.'],
  ['📒', 'Carnet de crédit', 'Notez qui vous doit de l\'argent, enregistrez les remboursements et relancez par WhatsApp en un clic.'],
  ['💰', 'Trésorerie réelle', 'Espèces, Mobile Money, banque : voyez l\'argent réellement disponible, pas seulement le bénéfice.'],
  ['📶', 'Fonctionne sans internet', 'Vendez même sans réseau. Tout se synchronise tout seul au retour de la connexion.'],
  ['👥', 'Vos employés, chacun son accès', 'Gérant ou caissier : chacun se connecte avec son compte, en même temps, sur son téléphone.'],
  ['🏦', 'Score et dossier bancaire', 'Un dossier clair de votre activité pour appuyer une demande de crédit en banque ou en microfinance.'],
  ['✨', 'Assistant intelligent', 'Posez vos questions en français : « Comment vont mes ventes ? », « Que dois-je racheter ? ».'],
];
const faqList = (plans: (PlanSettings & { whatsapp: string }) | null): [string, string][] => [
  ['Faut-il toujours avoir internet ?', 'Non. Vous pouvez vendre et enregistrer vos opérations sans connexion. Les données sont envoyées automatiquement dès que le réseau revient.'],
  ['Mes données sont-elles en sécurité ?', 'Votre compte est protégé par un mot de passe, et vos données sont stockées sur l\'infrastructure Cloudflare. Seuls vous et les personnes à qui vous donnez un accès y ont accès.'],
  ['Puis-je l\'utiliser sur téléphone ?', 'Oui. Nafora s\'installe comme une application depuis votre navigateur (Chrome), sans passer par un magasin d\'applications, et fonctionne aussi sur ordinateur.'],
  ['Combien ça coûte ?', plans?.enabled
    ? `La création du compte est gratuite, avec ${plans.trialDays} jours d\'essai des fonctions Pro. Ensuite, l\'abonnement annuel Pro coûte ${fmt(plans.price12)} ${plans.currency} par an, avec le conseil et l\'assistance inclus. Paiement par Mobile Money.`
    : 'Nafora est gratuit pendant la phase de lancement. Créez votre compte et profitez de toutes les fonctions.'],
  ['Que comprend l\'abonnement annuel ?', 'Toutes les fonctions Pro (caisse, stocks, dettes, trésorerie, employés illimités, assistant IA étendu) et le conseil et l\'assistance : prise en main, réponses prioritaires sur WhatsApp, point mensuel sur vos chiffres, conseils de gestion et aide pour votre dossier bancaire. Un seul prix, sans option à ajouter.'],
  ['Que se passe-t-il à la fin de l\'essai ?', 'Votre compte passe en lecture seule : vous gardez l\'accès à toutes vos données, mais rien de nouveau ne s\'enregistre tant que l\'abonnement Pro n\'est pas activé. Rien n\'est supprimé.'],
  ['Je ne suis pas à l\'aise avec la technologie, est-ce difficile ?', 'Non. La caisse se prend en main en quelques minutes : on touche les produits, on encaisse, c\'est tout. Vous pouvez même dicter la vente à la voix.'],
  ['Pour quels commerces ?', 'Boutiques, alimentation, quincaillerie, mode, restauration, pharmacie, services… tout petit commerce ou PME qui vend et suit des stocks ou des crédits.'],
];

const PAINS: [string, string][] = [
  ['Le cahier se perd, se mouille, se contredit', 'Nafora garde chaque vente, chaque dépense et chaque dette en sécurité, même si le téléphone change.'],
  ['« Combien j\'ai vraiment gagné ce mois ? »', 'Bénéfice du jour, du mois dernier ou d\'une période choisie, calculé automatiquement.'],
  ['Les clients qui oublient de payer', 'Le carnet de crédit note tout et prépare le rappel WhatsApp en un clic.'],
  ['Le stock qui manque au mauvais moment', 'Alertes de rupture, et la caisse bloque la vente d\'un produit épuisé.'],
];
const REASSURE: [string, string][] = [
  ['🎁', 'Essai Pro offert'], ['💳', 'Sans carte bancaire'], ['📶', 'Marche sans internet'], ['📱', 'Paiement Mobile Money'],
];
const SCREENS: [string, string, string][] = [
  ['accueil', 'Votre journée en un coup d\'œil', 'Ventes, dépenses, bénéfice et trésorerie réelle dès l\'ouverture.'],
  ['stocks', 'Vos stocks et votre marge', 'Capital immobilisé, valeur de vente et bénéfice attendu, article par article.'],
  ['dettes', 'Le carnet des dettes', 'Ce que vos clients vous doivent, ce que vous devez à vos fournisseurs.'],
  ['assistant', 'Un assistant qui répond', 'Posez vos questions en français : ventes, stock, dettes, caisse.'],
];
const Phone: React.FC<{ src: string; alt: string }> = ({ src, alt }) => (
  <div className="mx-auto w-[190px] sm:w-full max-w-[230px] rounded-[2rem] bg-stone-900 p-2 shadow-xl ring-1 ring-stone-700">
    <div className="relative rounded-[1.5rem] overflow-hidden bg-white">
      <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-12 h-1.5 rounded-full bg-stone-900/80 z-10" />
      <img src={src} alt={alt} loading="lazy" width={480} height={1445} className="w-full h-auto block" />
    </div>
  </div>
);
const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

export const LandingPage: React.FC<Props> = ({ onLogin, onRegister }) => {
  const [plans, setPlans] = useState<(PlanSettings & { whatsapp: string }) | null>(null);
  useEffect(() => { api.plans().then(setPlans).catch(() => {}); }, []);
  const [testimonials, setTestimonials] = useState<PublicTestimonial[]>([]);
  useEffect(() => { api.testimonials().then(r => setTestimonials(r.items)).catch(() => {}); }, []);
  const [showSticky, setShowSticky] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowSticky(window.scrollY > 520);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const wa = plans?.whatsapp ? `https://wa.me/${plans.whatsapp}?text=${encodeURIComponent('Bonjour, je souhaite en savoir plus sur Nafora.')}` : '';
  const assistWa = plans?.whatsapp ? `https://wa.me/${plans.whatsapp}?text=${encodeURIComponent("Bonjour, je souhaite profiter de l'assistance et du conseil inclus dans mon abonnement Nafora.")}` : '';
  const share = `https://wa.me/?text=${encodeURIComponent(`Découvre Nafora, l'application pour gérer ta boutique (ventes, stocks, crédits) même sans internet : ${typeof location !== 'undefined' ? location.origin : ''}`)}`;
  const btn = 'px-5 py-3 rounded-2xl font-bold text-sm transition active:scale-95';

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900" data-testid="landing">
      <header className="bg-emerald-950 text-white">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 sm:gap-2 font-black text-base sm:text-lg whitespace-nowrap"><Logo variant="horizontal" on="dark" className="h-9 sm:h-10" /></div>
          <nav className="flex items-center gap-1 sm:gap-2 shrink-0">
            <ThemeToggle className="!p-1.5 sm:!p-2" />
            <button onClick={onLogin} className="px-2 sm:px-3 py-2 rounded-xl text-[13px] sm:text-sm font-bold text-emerald-100 hover:bg-emerald-900 whitespace-nowrap" data-testid="landing-login"><span className="sm:hidden">Connexion</span><span className="hidden sm:inline">Se connecter</span></button>
            <button onClick={onRegister} className="px-2.5 sm:px-4 py-2 rounded-xl text-[13px] sm:text-sm font-bold bg-amber-400 text-stone-950 hover:bg-amber-300 whitespace-nowrap" data-testid="landing-register-top"><span className="sm:hidden">S'inscrire</span><span className="hidden sm:inline">Créer mon compte</span></button>
          </nav>
        </div>
      </header>

      <section className="bg-gradient-to-b from-emerald-950 via-emerald-950 to-emerald-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-12 sm:py-20 text-center">
          <Logo variant="stacked" on="dark" className="mx-auto mb-4 h-32 sm:h-40" alt="" />
          <h1 className="text-3xl sm:text-5xl font-black leading-tight">Gérez votre commerce depuis votre téléphone, <span className="text-amber-300">même sans internet</span></h1>
          <p className="mt-4 text-emerald-100 max-w-2xl mx-auto text-base sm:text-lg">Ventes, stocks, dettes de vos clients, dépenses et trésorerie au même endroit. Pensé pour les commerçants et PME d'Afrique de l'Ouest.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button onClick={onRegister} className={`${btn} bg-amber-400 text-stone-950 hover:bg-amber-300`} data-testid="landing-register">Créer mon compte gratuitement</button>
          </div>
          <p className="mt-3 text-xs text-emerald-200">Sans carte bancaire • installation depuis le navigateur • en français</p>
          <ul className="mt-8 flex flex-wrap justify-center gap-2 sm:gap-3 text-xs sm:text-sm font-semibold">
            {REASSURE.map(([i, t]) => <li key={t} className="px-3 py-1.5 rounded-full bg-white/10 border border-white/15"><span aria-hidden>{i}</span> {t}</li>)}
          </ul>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-12" aria-labelledby="enaction">
        <h2 id="enaction" className="text-2xl sm:text-3xl font-black text-center">Nafora en action dans votre boutique</h2>
        <p className="mt-2 text-center text-sm text-stone-600 max-w-xl mx-auto">Des commerçants comme vous, au comptoir, avec leur téléphone.</p>
        <figure className="mt-8 rounded-3xl overflow-hidden border border-stone-200 shadow-lg bg-emerald-950">
          <img src="/showcase/commerce.webp" alt="Commerçante souriante qui utilise Nafora sur son téléphone dans sa boutique" width={1200} height={800} loading="lazy" decoding="async" className="w-full h-auto block" />
        </figure>
        <div className="mt-5 grid gap-5 md:grid-cols-3">
          {SHOWCASE.map(([f, t, d, alt]) => (
            <figure key={f} className="rounded-2xl overflow-hidden border border-stone-200 shadow-md bg-white">
              <img src={`/showcase/${f}.webp`} alt={alt} width={1200} height={800} loading="lazy" decoding="async" className="w-full aspect-[3/2] object-cover object-top block" />
              <figcaption className="p-4"><h3 className="font-extrabold">{t}</h3><p className="mt-1 text-sm text-stone-600">{d}</p></figcaption>
            </figure>))}
        </div>
      </section>

      <section className="max-w-5xl mx-auto px-4 py-12" aria-labelledby="problemes">
        <h2 id="problemes" className="text-2xl sm:text-3xl font-black text-center">Vous vous reconnaissez ?</h2>
        <div className="mt-8 grid sm:grid-cols-2 gap-4">
          {PAINS.map(([p, a]) => (
            <div key={p} className="rounded-2xl border border-stone-200 bg-white p-5">
              <p className="font-extrabold text-rose-700">✗ {p}</p>
              <p className="mt-2 text-sm text-stone-700"><span className="font-bold text-emerald-700">✓ Avec Nafora : </span>{a}</p>
            </div>))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-12" aria-labelledby="fonctions">
        <h2 id="fonctions" className="text-2xl sm:text-3xl font-black text-center">Tout ce qu'il faut pour tenir votre boutique</h2>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map(([i, t, d]) => (
            <article key={t} className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
              <div className="text-3xl" aria-hidden>{i}</div><h3 className="mt-2 font-extrabold">{t}</h3><p className="mt-1 text-sm text-stone-600">{d}</p>
            </article>))}
        </div>
      </section>

      <section className="bg-gradient-to-b from-stone-50 to-emerald-50 border-y border-stone-200" aria-labelledby="apercu">
        <div className="max-w-6xl mx-auto px-4 py-14">
          <h2 id="apercu" className="text-2xl sm:text-3xl font-black text-center">L'application, telle que vous l'utiliserez</h2>
          <p className="mt-2 text-center text-sm text-stone-600 max-w-xl mx-auto">Des écrans simples, des chiffres clairs, en français. Faites défiler pour voir.</p>
          <div className="mt-10 flex sm:grid sm:grid-cols-4 gap-5 overflow-x-auto sm:overflow-visible snap-x snap-mandatory pb-4 -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none]">
            {SCREENS.map(([f, t, d]) => (
              <figure key={f} className="shrink-0 snap-center w-[220px] sm:w-auto text-center">
                <Phone src={`/screens/${f}.webp`} alt={`Écran ${t} de Nafora`} />
                <figcaption className="mt-4"><h3 className="font-extrabold text-sm">{t}</h3><p className="mt-1 text-xs text-stone-600">{d}</p></figcaption>
              </figure>))}
          </div>
          <div className="mt-8 text-center"><button onClick={onRegister} className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`}>Essayer gratuitement</button></div>
        </div>
      </section>

      <section className="bg-white border-y border-stone-200">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <h2 className="text-2xl sm:text-3xl font-black text-center">Démarrer en 3 étapes</h2>
          <ol className="mt-8 grid sm:grid-cols-3 gap-4 text-center">
            {[['1', 'Créez votre compte', 'Votre nom, votre boutique, votre numéro de téléphone : 2 minutes.'], ['2', 'Ajoutez vos produits', 'Saisissez vos articles et vos prix, ou commencez à vendre tout de suite.'], ['3', 'Vendez et suivez', 'Vos chiffres du jour, vos stocks et vos crédits se mettent à jour automatiquement.']].map(([n, t, d]) => (
              <li key={n} className="p-4"><div className="mx-auto w-10 h-10 rounded-full bg-emerald-700 text-white font-black flex items-center justify-center">{n}</div><h3 className="mt-3 font-extrabold">{t}</h3><p className="text-sm text-stone-600 mt-1">{d}</p></li>))}
          </ol>
        </div>
      </section>

      {testimonials.length > 0 && (
        <section className="max-w-5xl mx-auto px-4 py-12" aria-labelledby="avis">
          <h2 id="avis" className="text-2xl sm:text-3xl font-black text-center">Ils gèrent leur commerce avec Nafora</h2>
          <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {testimonials.map((t, i) => (
              <figure key={i} className="rounded-2xl border border-stone-200 bg-white p-5">
                <div className="text-amber-400 text-sm" aria-label={`${t.rating} sur 5`}>{'★'.repeat(t.rating)}</div>
                <blockquote className="mt-1 text-sm text-stone-700">« {t.text} »</blockquote>
                <figcaption className="mt-3 text-xs text-stone-500"><b className="text-stone-900">{t.name}</b>{t.shop_label ? ` · ${t.shop_label}` : ''}{t.city ? `, ${t.city}` : ''}</figcaption>
              </figure>))}
          </div>
        </section>
      )}

      <section className="max-w-4xl mx-auto px-4 py-12" aria-labelledby="tarifs">
        <h2 id="tarifs" className="text-2xl sm:text-3xl font-black text-center">Tarifs simples</h2>
        {plans?.enabled ? (
          <div className="mt-8 grid gap-4 max-w-md mx-auto">
            <div className="bg-emerald-900 text-white rounded-2xl p-6"><h3 className="font-extrabold text-lg">Pro</h3><div className="text-3xl font-black mt-1">{fmt(plans.price12)} <span className="text-base font-bold">{plans.currency} / an</span></div>
              <p className="text-xs text-emerald-200">Abonnement annuel unique, assistance et conseil compris</p>
              <ul className="mt-3 text-sm text-emerald-100 space-y-1 list-disc pl-5"><li>Caisse, stocks, dettes, trésorerie</li><li>Fonctionne sans internet</li><li>Employés illimités</li><li>Assistant IA étendu</li><li><b>Conseil &amp; Assistance inclus</b> (accompagnement humain sur WhatsApp)</li><li>Paiement par Mobile Money ou en ligne (international)</li></ul>
              <p className="mt-3 text-xs text-amber-200">{plans.trialDays} jours d'essai Pro offerts à l'inscription.</p></div>
            <div className="bg-white border-2 border-amber-300 rounded-2xl p-6" data-testid="assist-offer">
              <div className="flex items-center justify-between gap-2"><h3 className="font-extrabold text-lg">Assistance & Conseil</h3><span className="text-[11px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-900 whitespace-nowrap">Inclus dans Pro</span></div>
              <p className="mt-1 text-sm text-stone-600">Nafora ne vous laisse pas seul : un vrai accompagnement humain, en français, sur WhatsApp.</p>
              <ul className="mt-3 text-sm text-stone-700 space-y-1.5 list-disc pl-5">
                <li><b>Prise en main personnalisée</b> : on vous guide pour démarrer et saisir vos premiers produits.</li>
                <li><b>Réponse prioritaire</b> à vos questions, du lundi au vendredi.</li>
                <li><b>Point mensuel sur vos chiffres</b> : bénéfice, stocks à racheter, dettes à relancer.</li>
                <li><b>Conseils de gestion</b> adaptés à votre commerce pour mieux vendre et mieux gagner.</li>
                <li><b>Aide pour votre dossier bancaire</b> : comprendre votre score et préparer une demande de crédit.</li>
              </ul>
              {wa
                ? <a href={assistWa} target="_blank" rel="noopener noreferrer" className={`${btn} mt-4 inline-block bg-green-600 text-white hover:bg-green-700`}>Profiter de l'assistance</a>
                : <p className="mt-4 text-xs text-stone-500">Contactez-nous pour en savoir plus.</p>}
            </div>
          </div>
        ) : (
          <p className="mt-6 text-center text-stone-600">Nafora est <b>gratuit pendant la phase de lancement</b>. Créez votre compte et profitez de toutes les fonctions.</p>)}
      </section>

      <section className="bg-white border-y border-stone-200" aria-labelledby="faq">
        <div className="max-w-3xl mx-auto px-4 py-12">
          <h2 id="faq" className="text-2xl sm:text-3xl font-black text-center">Questions fréquentes</h2>
          <div className="mt-6 space-y-3">{faqList(plans).map(([q, a]) => <details key={q} className="rounded-xl border border-stone-200 p-4 group"><summary className="font-bold cursor-pointer">{q}</summary><p className="mt-2 text-sm text-stone-600">{a}</p></details>)}</div>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-4 py-12 text-center">
        <h2 className="text-2xl sm:text-3xl font-black">Prêt à mieux gérer votre commerce ?</h2>
        <p className="mt-2 text-sm text-stone-600">{plans?.enabled && plans.trialDays ? `${plans.trialDays} jours d'essai Pro offerts, sans carte bancaire.` : 'Création du compte en 2 minutes.'}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button onClick={onRegister} className={`${btn} bg-emerald-700 text-white hover:bg-emerald-800`}>Créer mon compte</button>
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className={`${btn} bg-green-600 text-white hover:bg-green-700`}>Nous écrire sur WhatsApp</a>}
          <a href={share} target="_blank" rel="noopener noreferrer" className={`${btn} border border-stone-300 bg-white`}>Recommander à un commerçant</a>
        </div>
      </section>

      {showSticky && (
        <div className="fixed bottom-0 inset-x-0 z-40 sm:hidden bg-emerald-950/95 backdrop-blur border-t border-emerald-800 px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-emerald-100">Essayez Nafora gratuitement</span>
          <button onClick={onRegister} className="px-4 py-2 rounded-xl text-sm font-bold bg-amber-400 text-stone-950 active:scale-95">Créer mon compte</button>
        </div>
      )}

      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" aria-label="Nous écrire sur WhatsApp"
          className="fixed right-4 bottom-20 sm:bottom-6 z-50 flex items-center gap-2 rounded-full bg-[#25D366] text-white shadow-xl shadow-black/30 hover:bg-[#1ebe5b] active:scale-95 transition p-3.5 sm:px-5 sm:py-3">
          <svg viewBox="0 0 32 32" className="w-7 h-7 shrink-0" fill="currentColor" aria-hidden="true"><path d="M16.04 3C9.4 3 4 8.38 4 15.02c0 2.12.55 4.18 1.6 6L4 29l8.17-1.57a12 12 0 0 0 3.87.64C22.68 28.07 28 22.69 28 16.05 28 9.4 22.68 3 16.04 3Zm0 22.03c-1.2 0-2.37-.2-3.48-.6l-.5-.17-4.85.93.96-4.7-.2-.5a9.9 9.9 0 0 1-1.5-5.2c0-5.5 4.5-9.97 10.04-9.97 5.52 0 9.97 4.5 9.97 10.03 0 5.52-4.5 10.18-9.94 10.18Zm5.47-7.46c-.3-.15-1.77-.88-2.05-.98-.27-.1-.47-.15-.67.15-.2.3-.77.98-.95 1.18-.17.2-.35.22-.65.07-.3-.15-1.27-.47-2.42-1.5-.9-.8-1.5-1.78-1.67-2.08-.18-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.62-.92-2.22-.24-.58-.5-.5-.67-.5h-.57c-.2 0-.52.07-.8.38-.27.3-1.05 1.03-1.05 2.5s1.07 2.9 1.22 3.1c.15.2 2.1 3.2 5.08 4.5.7.3 1.26.48 1.7.62.72.23 1.37.2 1.88.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z"/></svg>
          <span className="hidden sm:inline font-bold text-sm">Une question ? WhatsApp</span>
        </a>
      )}

      <footer className="bg-emerald-950 text-emerald-200 text-sm pb-14 sm:pb-0">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} Nafora</span>
          <nav className="flex flex-wrap gap-4"><a href="/a-propos.html" className="hover:text-white">À propos</a><a href="/contact.html" className="hover:text-white">Contact</a><a href="/confidentialite.html" className="hover:text-white">Confidentialité</a><a href="/conditions.html" className="hover:text-white">Conditions d'utilisation</a></nav>
        </div>
      </footer>
    </div>
  );
};
