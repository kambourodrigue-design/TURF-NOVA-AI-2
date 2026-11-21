# Audit final — indicateurs de résultats Turf Nova

## Constat sur la base D1 communiquée le 21/11/2026

Sur 353 vérifications : 244 `tierce_reussi` étaient NULL (244 en août), 14 lignes ont `tierce_reussi=1` alors que seuls 3 des 4 premiers officiels sont dans la sélection, et 7 résultats ne contenaient pas les quatre positions attendues.

## Interprétation du code source V2.2 fourni

Le Worker V2.2 définit explicitement `tierce_reussi` comme la couverture des trois premiers officiels. Il calcule aussi `quarteReussi`, mais ne l'enregistre pas dans D1. Les 14 cas où `tierce_reussi=1` et `top4_couverts=3` ne sont donc pas des faux positifs pour le Tiercé : ils sont cohérents avec la définition Top 3. L'anomalie est surtout un défaut de sémantique/traçabilité par rapport à l'indicateur Quarté que l'utilisateur souhaite suivre.

Le code fourni ne persistait pas non plus la couverture Quinté. Il comptait `chevaux_corrects` sur les cinq chevaux de l'arrivée alors que l'administration affichait cette moyenne sur quatre. L'endpoint de statistiques divisait les réussites Tiercé/Quarté par le nombre total de lignes, y compris les lignes NULL.

## Correctif préparé dans ce paquet

- `tierce_reussi` reste un alias historique du Top 3 pour ne pas changer silencieusement sa signification.
- Ajout des colonnes `top3_reussi`, `quarte_reussi`, `quinte_reussi`.
- Le Worker ne renseigne un indicateur que si toutes les positions officielles 1..N existent et sont distinctes ; une arrivée partielle produit NULL.
- Le nombre de chevaux corrects est mesuré sur le Top 5.
- Les labels d’apprentissage `courses_features` ne sont complétés que lorsque les quatre premières positions officielles sont toutes présentes.
- Les taux Top 3, Quarté et Quinté utilisent chacun leur propre dénominateur de résultats disponibles.
- La moyenne de chevaux corrects est affichée sur 5 et calculée seulement sur les courses avec Top 5 complet.
- L'administration est ajustée en conséquence.
- Migration additive `migrations/0004-resultats-indicateurs.sql` ; aucune donnée historique n'est mise à jour ni supprimée.

## À exécuter avant déploiement

1. Sauvegarder D1.
2. Vérifier que les trois colonnes n'existent pas déjà.
3. Exécuter `migrations/0004-resultats-indicateurs.sql` une seule fois.
4. Déployer `worker.js` et `public/` de ce paquet en conservant les bindings et secrets Cloudflare existants.
5. Vérifier les nouvelles lignes : les trois indicateurs doivent être 0/1 ou NULL si l'arrivée est incomplète.
6. Vérifier `/api/stats-performance` et les KPI de l'administration.

Les anciennes lignes restent intactes : les nouvelles colonnes seront NULL pour l'historique jusqu'à une éventuelle opération de recalcul distincte et approuvée.

## Limites

- Aucun accès à Cloudflare D1 ou au Worker distant n'a été effectué.
- Aucun déploiement n'a été effectué.
- Les métriques historiques précédemment calculées restent des mesures de couverture, pas des taux de tickets PMU gagnants ni un ROI.
- Le backtest/calibrage V2.2 demeure séparé de ce correctif de traçabilité des résultats.
