# Correction de l'extraction des cotes (V2.2)

## Problème constaté
Sur la course du jour, des chevaux affichaient des cotes aberrantes (n°12 à 284, n°9 à 142) alors que le programme PMU les donnait entre 13 et 20. Le Worker lisait uniquement `dernierRapportDirect` (marché en cours). Tôt le matin, avec très peu de paris, cette valeur peut être absurde. Elle était affichée ET envoyée au moteur statistique et aux IA (les explications citaient « cote 142 »).

## Correction
- Une seule fonction `coteMarche(p, termine)` est désormais utilisée partout (prompt IA, moteur statistique, fiche Premium, sélection gratuite, jeu de données `courses_features`, archive).
- Elle lit `dernierRapportDirect` et `dernierRapportReference` (cote du programme). Si les deux existent et s'écartent de plus de 2,5 fois (ratio > 2,5 ou < 0,4), la cote de référence est retenue. Si une seule existe, elle est utilisée.
- Pour une course terminée (archive), la cote directe finale est conservée telle quelle.
- Le backtest (instantanés archivés) n'est pas modifié.

## Nouveaux outils d'administration
- `GET /api/admin/diagnostic-cotes?reunion=R1&course=C3` (connecté en admin) : affiche pour chaque partant la cote directe, la cote de référence, la cote retenue, les écarts corrigés et `referenceDisponible`. Si `referenceDisponible` vaut `false`, le champ de référence n'existe pas dans la réponse PMU sous ce nom : transmettre le résultat pour adapter l'extraction.
- Bouton « Régénérer (efface et refait) » (admin, onglet Historique) : efface le pronostic verrouillé de la course du jour (tables `predictions`, `predictions_ia`, `predictions_moteur`, `courses_features` pour cette course) et ses caches, puis le refait. Refusé si la course est déjà partie. Les IA sont rappelées (coût).

## Limites
- Le nom du champ `dernierRapportReference` n'a pas pu être vérifié contre l'API PMU réelle depuis cette session (pas d'accès réseau). Utiliser le diagnostic ci-dessus après déploiement.
- Le seuil de 2,5 est un paramètre de départ.
- Les pronostics déjà verrouillés gardent leurs anciennes cotes et explications tant qu'ils ne sont pas régénérés.
