# Turf Nova AI V2.1 — calibration prudente des pondérations

## Nouveautés
- Version moteur `2.1.0`.
- Ajout de `moteur_poids_appris` pour stocker les poids validés par famille de course.
- Nouveau bouton d'administration « Calibrer les poids » et endpoint `POST /api/admin/calibrer-moteur`.
- L'apprentissage utilise uniquement les classements réellement enregistrés avant les courses (`predictions_moteur`) puis rapprochés des arrivées officielles archivées.
- Les courses sont triées chronologiquement : 70 % les plus anciennes pour rechercher les poids, 30 % les plus récentes pour une validation indépendante.
- Recherche déterministe de 240 combinaisons par famille. Les poids sont normalisés à 100 % et restent non négatifs.
- Les poids ne sont activés que si au moins 40 courses exploitables existent dans la famille, que le jeu de validation contient au moins 10 courses et que le score de validation progresse d'au moins 0,5 point de pourcentage. Sinon, les poids actifs sont conservés.
- Si aucun apprentissage validé n'existe, le moteur utilise les pondérations initiales V2.

## Limite de données importante
Le backtest historique existant peut reconstruire des classements rétrospectifs, mais il ne conserve pas nécessairement les composants pré-course individuels de chaque cheval pour toutes les anciennes courses. Pour éviter de prétendre apprendre à partir de données reconstruites avec biais, la calibration utilise les instantanés `predictions_moteur` effectivement enregistrés avant la course. Les 185 courses archivées ne signifient donc pas automatiquement 185 exemples d'apprentissage : le nombre réel est affiché par le bouton de calibration.

## Installation
1. Sauvegarder D1 et conserver le ZIP V2.0 pour rollback.
2. Exécuter `migrations/0002-calibration-poids.sql` dans D1. Le Worker crée également cette table avec `CREATE TABLE IF NOT EXISTS` si elle manque.
3. Remplacer le Worker et le dossier `public/` par ceux du paquet V2.1, sans modifier les secrets Cloudflare.
4. Déployer le Worker.
5. Dans l'administration > Performance des IA, cliquer « Calibrer les poids ».
6. Si l'échantillon est insuffisant, laisser tourner les archives et les pré-générations, puis relancer plus tard.
7. Relancer le backtest moteur pour comparer la version `2.1.0`.

## Préservation et retour arrière
- La migration est additive : aucune table existante n'est supprimée.
- Les anciens résultats de backtest V2.0 restent dans D1. La version V2.1 utilise une nouvelle clé de version et son backtest doit être recalculé.
- Pour revenir au code V2.0, restaurer les fichiers du paquet précédent. La table `moteur_poids_appris` peut rester en place sans gêner le Worker V2.0.
- Aucun déploiement Cloudflare n'est effectué depuis ce paquet.

## Vérifications locales effectuées
- `node --check worker.js` : OK.
- JavaScript intégré à `public/admin.html` : syntaxe OK.
- Migration `0002-calibration-poids.sql` exécutée sur SQLite local : OK, 8 colonnes vérifiées.
