# Correctif interfaces — indicateurs Top 3 / Quarté / Quinté

## Modifications
- Le Worker transmet désormais `quinteReussi` dans `/api/resultats-du-jour`, en complément de `quarteReussi` et de l'alias historique `tierceReussi`.
- La page publique affiche séparément les badges Quinté, Quarté et Top 3 lorsqu'ils sont effectivement réussis. Un résultat non vérifiable ne reçoit aucun badge.
- Le compteur public Top 3 utilise désormais `tauxTop3Reussi` et `echantillonTop3` (et non le taux « au moins un coup sûr »). Il est masqué tant que moins de cinq courses sont évaluables. Le libellé ne prétend plus couvrir les 30 derniers jours puisque l'API renvoie les données cumulées.
- Le tableau de bord admin affiche les taux Top 3, Quarté et Quinté avec le nombre de réussites et le dénominateur évaluable pour chaque indicateur.
- L'historique admin détaille les trois résultats par course, en distinguant « Non évaluable » d'un échec.

## Données et compatibilité
- Aucun SQL de production n'a été exécuté et aucune donnée D1 n'a été modifiée.
- Les 353 anciennes lignes dont les nouveaux champs sont `NULL` restent inchangées et sont exclues des dénominateurs correspondants.
- `tierce_reussi` demeure conservé comme alias historique du Top 3.

## Vérifications locales
- `node --check worker.js` : OK.
- Vérification syntaxique des scripts JavaScript inline de `admin.html` et `index.html` : OK.
- Déploiement Cloudflare : non effectué.
