# Mise à jour v4 — Espace admin : statistiques et messages

## 1. Migration de la base (OBLIGATOIRE, une seule fois)
Cloudflare → Workers & Pages → D1 → votre base → **Console**, collez le contenu de `migration-v4.sql` et exécutez.
(Nouvelle installation : `schema.sql` contient déjà tout.)
Sans cette migration, l'application fonctionne mais les nouveaux onglets admin affichent une erreur.

## 2. Fichiers à envoyer sur GitHub
Tout le dossier convient. Nouveaux/modifiés : `migration-v4.sql`, `schema.sql`, `functions/_lib/site.ts`, `functions/api/[[path]].ts`, `src/App.tsx`, `src/services/api.ts`, `src/components/admin/{AdminDashboard,AdminSite}.tsx`, `src/components/common/AnnouncementsBar.tsx`.

## 3. Nouveautés (compte administrateur → onglets en haut de l'espace admin)
- **Statistiques du site** : commerçants, actifs sur 7 jours, inscriptions, visites, ventes et volume cumulés, courbes 30 jours, secteurs, pays, usage de l'IA gratuite du jour. Les visites comptent une ouverture par session, sans cookie.
- **Messages** : publiez un message (titre + texte) à tous, aux propriétaires, à un secteur ou à un pays, avec durée de visibilité. Il s'affiche en haut de l'application des destinataires jusqu'à ce qu'ils le ferment ; vous voyez combien l'ont lu.
