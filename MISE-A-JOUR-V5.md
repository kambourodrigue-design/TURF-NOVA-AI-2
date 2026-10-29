# Mise à jour v5 — Surveillance, facturation, page d'accueil publique

## 1. Migration de la base (OBLIGATOIRE, une seule fois)
Cloudflare → D1 → votre base → **Console** : exécutez `migration-v4.sql` si ce n'est pas déjà fait, puis `migration-v5.sql`.
Envoyez ensuite tout le dossier sur GitHub (nouveaux dossiers inclus : `functions/`, `public/`, `src/components/landing`).

## 2. Surveillance (admin → onglet « Surveillance »)
- Journal des erreurs du serveur et de l'application (plantages d'écran inclus), regroupées par type, avec un voyant vert / orange / rouge.
- Adresse de contrôle `https://VOTRE-SITE/api/health` : branchez-la sur **UptimeRobot** (gratuit) pour être prévenu par e-mail si le site tombe.
- **Alertes Telegram (facultatif, gratuit)** : sur Telegram, parlez à @BotFather → /newbot → copiez le jeton ; envoyez un message à votre bot, puis ouvrez `https://api.telegram.org/botVOTRE_JETON/getUpdates` pour lire votre `chat id`. Dans Cloudflare → Settings → Variables and secrets, ajoutez `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` (type Secret). Le bouton « Tester l'alerte » vérifie. Une même erreur n'alerte qu'une fois par 10 minutes. Vous êtes aussi alerté d'un nouveau paiement à valider.
- Si votre projet est géré par `wrangler.toml`, ajoutez ces deux variables dans la section `[vars]` du fichier plutôt que dans le tableau de bord.

## 3. Facturation (admin → onglet « Abonnements »)
Désactivée par défaut : **tant que vous ne cochez pas « Facturation activée », rien ne change pour personne.**
- Plan **Pro** payé par Mobile Money / virement, validé à la main : le commerçant (Paramètres → Abonnement) choisit 1, 3 ou 12 mois, paie selon vos instructions, saisit la référence de transaction ; vous vérifiez sur votre application Mobile Money puis cliquez **Valider** (ou Refuser). L'abonnement se prolonge automatiquement.
- Réglages : prix, durée d'essai, questions IA/jour et employés autorisés en gratuit, instructions de paiement. Prix par défaut : 2 500 / 6 500 / 25 000 F CFA — à adapter.
- À l'activation, chaque boutique reçoit l'essai Pro (30 jours par défaut) à partir de ce jour.
- Plan gratuit : **jamais de blocage de la caisse ni des données**. Limites : assistant IA (5/jour), employés (1). Pro/essai : IA 15/jour, employés illimités.
- Vous pouvez aussi offrir des mois à une boutique (route admin « grant »).
- Un paiement par application (CinetPay, PayDunya, FedaPay…) automatiserait la validation : possible plus tard, après ouverture d'un compte marchand chez l'un d'eux.

## 4. Page d'accueil publique
- Les visiteurs non connectés voient la page de présentation (fonctions, 3 étapes, tarifs, questions fréquentes, WhatsApp, bouton « Recommander à un commerçant »). L'application installée ouvre directement la connexion.
- Pages légales : `/confidentialite.html`, `/conditions.html`, `/a-propos.html`, `/contact.html`, plus `/robots.txt` et `/sitemap.xml` automatiques. Le numéro WhatsApp vient de votre variable `SUPPORT_WHATSAPP`.
- **À relire avant de publier** : les textes légaux sont des modèles généraux, pas un avis juridique. Faites-les relire et complétez le nom de l'éditeur / coordonnées si vous le souhaitez.
- Dans Google Search Console, ajoutez votre site et envoyez `/sitemap.xml` pour le référencement.

## 5. Fichiers
Nouveaux : `migration-v5.sql`, `functions/_lib/{billing,monitor}.ts`, `functions/{robots.txt,sitemap.xml}.ts`, `public/*.html`, `src/components/landing/LandingPage.tsx`, `src/components/admin/AdminOps.tsx`, `src/components/settings/BillingPanel.tsx`.
Modifiés : `schema.sql`, `index.html`, `vite.config.ts`, `src/main.tsx`, `src/App.tsx`, `src/services/api.ts`, `functions/api/[[path]].ts`, `functions/_lib/{ai,site,team,util}.ts`, composants admin.

## Option « Lecture seule après l'essai » (v5.3)
Admin → Abonnements → cocher « Lecture seule après l'essai » → Enregistrer. Aucune migration.
Boutique sans abonnement payé et essai terminé : consultation possible (tableau de bord, stocks, dettes, ratios), mais le serveur refuse toute nouvelle écriture (402) et la caisse est verrouillée.
Pour rouvrir : le commerçant déclare son paiement, tu le valides (ou « offrir des mois »). Effet sous 10 minutes au maximum, ou à la prochaine ouverture de l'application.
Décoché (par défaut) : le plan gratuit ne bloque rien.
