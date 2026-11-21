# Turf Nova AI V2.2 — correction backtest et calibration

## Ce qui est corrigé

- Version du moteur : `2.2.0`.
- Le backtest V2.2 conserve le classement détaillé de chaque course dans `backtest_moteur.classement_composants_json` (numéro, score, position et composants utilisés).
- La calibration lit désormais les classements détaillés du backtest V2.2, et non exclusivement `predictions_moteur`. Elle peut donc exploiter les courses recalculées en mode walk-forward.
- Les disciplines archivées `ATTELE` et `MONTE` sont regroupées dans la famille `TROT`; `HAIE`, `STEEPLECHASE` et `CROSS` dans `OBSTACLE`; `PLAT` reste `PLAT`.
- Les résultats V2.0 et V2.1 ne sont ni supprimés ni écrasés. V2.2 utilise sa propre version de clé dans le backtest.
- Les écritures V2.2 sont rejouables : une même course/version est mise à jour en cas de relance plutôt que dupliquée.
- La colonne manquante est ajoutée automatiquement par le Worker si elle n'existe pas. Le fichier `migrations/0003-backtest-composants.sql` est l'alternative manuelle, à ne pas exécuter si la colonne existe déjà.

## Limites connues des archives actuelles

L'audit D1 communiqué le 21/11/2026 montre 2 930 lignes `archive_partants` et aucune valeur non NULL dans `historique_json`. V2.2 ne fabrique pas ces historiques absents. Le moteur utilise les informations réellement présentes (musique, cote, driver, entraîneur, corde, poids et archives antérieures disponibles). Les composants dépendant d'un historique absent peuvent rester neutres ou être peu documentés. La qualité de la calibration s'améliorera à mesure que l'archive historique s'enrichira.

## Déploiement prudent

1. Télécharger et conserver une copie de la version actuellement déployée.
2. Déployer le contenu de ce paquet V2.2 sur le Worker existant, en conservant les bindings, secrets et variables Cloudflare déjà configurés. Ne pas remplacer les secrets par des valeurs du paquet.
3. Au premier passage, le Worker ajoute automatiquement `classement_composants_json` si nécessaire.
4. Lancer le backtest moteur V2.2 depuis l'administration. Les courses seront traitées selon le budget existant par lot; plusieurs exécutions peuvent être nécessaires.
5. Vérifier D1 avec les requêtes ci-dessous avant de lancer la calibration.
6. Lancer la calibration uniquement quand les classements détaillés sont bien présents.

## Vérifications D1

```sql
PRAGMA table_info(backtest_moteur);

SELECT version, COUNT(*) AS total,
       SUM(CASE WHEN selection_json <> '[]' THEN 1 ELSE 0 END) AS selections_valides,
       SUM(CASE WHEN classement_composants_json IS NOT NULL
                 AND classement_composants_json <> '[]' THEN 1 ELSE 0 END) AS classements_detaillees
FROM backtest_moteur
GROUP BY version
ORDER BY version;

SELECT discipline, COUNT(*) AS courses_terminees
FROM archive_courses
WHERE termine=1
GROUP BY discipline
ORDER BY discipline;
```

## Contrôles effectués sur le paquet

- `node --check worker.js` : réussi.
- Contrôle SQL de la colonne additive et de la requête d'insertion : effectué localement.
- Aucun déploiement Cloudflare ni aucune modification de la base D1 distante n'a été effectué par cette préparation.
