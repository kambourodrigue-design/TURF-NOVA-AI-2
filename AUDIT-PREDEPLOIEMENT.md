# Turf Nova AI V2 — audit de préproduction

## Résumé

- Le paquet est une préproduction : aucun déploiement Cloudflare n'a été effectué.
- Le Worker V2 conserve les routes, les fonctionnalités publiques, les abonnements et les traitements présents dans le ZIP source ; les changements métier sont additifs.
- Le moteur statistique est indépendant des fournisseurs IA et le consensus combine le moteur, DeepSeek et GPT Sol.
- L'indice sur 100 est un score de classement, pas une probabilité calibrée.

## Configuration Wrangler vérifiée

Le fichier `wrangler.jsonc` du paquet reprend la configuration active communiquée :

- Worker `turf-nova-ai-2`, entrée `worker.js` ;
- D1 `DB`, base `turf-nova-db` ;
- KV `CACHE_KV` ;
- assets `ASSETS`, dossier `./public` ;
- `compatibility_date` conservée ;
- variables publiques VAPID conservées.

Les deux Cron existants sont conservés et deux Cron sont ajoutés :

- `0 1 * * *` : tâches existantes d'expiration et de vérification nocturne ;
- `0 6 * * *` : notification push du pronostic du jour ;
- `*/30 * * * *` : archivage historique ;
- `*/15 * * * *` : pré-génération de la course du jour.

## Audit du code D1 (statique/local)

- Les définitions `archive_courses` et `archive_partants` sont identiques à celles du Worker source fourni.
- `predictions_ia`, `push_subscriptions` et `quota_ia` sont déjà présentes dans le Worker source.
- V2 ajoute `predictions_moteur` et `backtest_moteur`, plus des index sur les archives. La migration additive correspondante est dans `migrations/0001-moteur-v2.sql`.
- Les instructions SQL statiques `CREATE TABLE` et `CREATE INDEX` du Worker ont été exécutées dans une base SQLite locale de test : 16/16 acceptées.
- Les créations utilisent `IF NOT EXISTS` ; aucune instruction `DROP` ou suppression de données n'est incluse.

**Limite importante :** le compte Cloudflare et la base D1 distante n'étaient pas accessibles depuis cette session. Le contenu réel de D1, ses colonnes/index existants, les secrets Cloudflare et les Cron réellement actifs n'ont donc pas pu être interrogés. Le fichier Wrangler confirme les identifiants et bindings déclarés, pas l'état réel des ressources distantes.

## Correction du rattrapage historique

L'ancien parcours commençait par aujourd'hui et hier. Les courses encore sans arrivée pouvaient consommer le budget à répétition et retarder le rattrapage historique.

V2 utilise désormais un curseur persistant `archive:cursor-date-v2` qui avance du plus ancien jour vers le plus récent. Les deux derniers jours sont exclus du rattrapage. Une journée en erreur reste au curseur pour être retentée ; les dates sans programme PMU (404 sur le programme journalier) sont sautées. La date de référence est calculée sur le fuseau `Europe/Paris`.

## Variables et secrets à vérifier dans Cloudflare

Ne jamais mettre les secrets dans `wrangler.jsonc` ni les transmettre dans le chat.

- Duo IA : `DEEPSEEK_API_KEY` et `OPENAI_API_KEY`.
- Paiement MyChariow : `CHARIOW_API_KEY`.
- Administration : `ADMIN_EMAIL`.
- Email : `RESEND_API_KEY` et `EMAIL_FROM`.
- Notifications push : `VAPID_PRIVATE_KEY` ; les valeurs publiques `VAPID_PUBLIC_KEY` et `VAPID_SUBJECT` sont déjà reprises dans le fichier de configuration.
- `SITE_DOMAIN` est facultatif si le domaine est résolu autrement.
- `GROQ_API_KEY` et `ANTHROPIC_API_KEY` sont des fournisseurs de repli facultatifs selon la configuration souhaitée.

## Contrôles locaux exécutés

- `node --check worker.js` : OK.
- Scripts JavaScript intégrés à `public/admin.html` : OK.
- `wrangler.jsonc` : JSON valide ; bindings et quatre Cron vérifiés.
- SQL statique : 16 instructions de création de tables/index exécutées dans SQLite local : OK.
- Tests du curseur d'archive : pagination selon le budget, reprise au jour suivant et maintien du curseur en cas d'erreur : OK.

## Avant mise en production

1. Exécuter un audit en lecture seule de D1 distante (tables, colonnes, index et volumes) avec le compte Cloudflare du propriétaire.
2. Vérifier dans Cloudflare les secrets cités ci-dessus et les Cron actifs.
3. Faire une sauvegarde D1 avant le premier déploiement.
4. Déployer en préproduction ou sur un Worker de test, contrôler les routes principales et tester les nouveaux endpoints admin.
5. Ne lancer l'archivage historique complet qu'après validation du comportement PMU et des quotas.

## Retour arrière

Le ZIP source original n'est pas modifié. Pour revenir au code précédent, restaurer les fichiers du ZIP original et son Wrangler actif. Les deux nouvelles tables, les index et la clé KV du curseur sont additifs ; aucun mécanisme de suppression automatique n'est exécuté au rollback.
