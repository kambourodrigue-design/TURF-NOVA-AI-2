# Turf Nova AI — moteur V2 (préproduction)

## Périmètre livré

- Ajout d'un moteur statistique indépendant des deux fournisseurs IA.
- Pondérations différentes selon la famille de course : plat, trot, obstacle et discipline non identifiée.
- Analyse des cinq dernières performances détaillées PMU, avec repli sur la musique.
- Utilisation des cotes comme signal secondaire, et des réductions kilométriques pour le trot lorsque disponibles.
- Exploitation des archives antérieures à la date de course : performances du même cheval sur hippodrome/disciplines/distances comparables, réussite des drivers et entraîneurs dans la discipline, ainsi que statistiques de corde dans le même contexte.
- Lissage des petits échantillons historiques pour limiter les conclusions tirées de quelques départs.
- Consensus pondéré entre DeepSeek, GPT Sol et le moteur statistique.
- Pondération adaptative des IA uniquement après au moins 30 courses évaluées sur les 180 derniers jours ; sinon poids neutres.
- Validation des réponses IA : suppression des numéros absents, non-partants et doublons ; les noms sont repris depuis la liste PMU officielle.
- Enregistrement des classements statistiques dans `predictions_moteur` et suivi comparatif via `predictions_ia`.
- Ajout d’un backtest rétrospectif « walk-forward » par lots : il reconstitue les données pré-course depuis les archives, calcule les statistiques en excluant les résultats de la date testée, puis compare la sélection du moteur aux huit plus petites cotes. Aucun appel aux IA n’est effectué pendant le backtest.
- Ajout dans l’administration des commandes « Backtest moteur (lot) » et « Backtest moteur (auto) », avec moyenne de chevaux corrects, taux de tiercé/quarté et comparaison au marché.
- Correction du marquage `top4_reel` : une cinquième place n'est plus comptée comme un Top 4.
- Profondeur de rattrapage d'archives portée à 1 095 jours, avec un lot automatique prudent de 10 courses par exécution.
- Correction du rattrapage : curseur persistant du plus ancien jour au plus récent ; les deux derniers jours sont exclus pour éviter que les courses en cours bloquent l'historique ; une date en erreur reste prioritaire au prochain passage ; les dates sans programme PMU (404 sur le programme journalier) sont sautées.
- Tableau admin : périodes de comparaison jusqu'à trois ans et archivage automatique prolongé.

## Pondérations initiales

Ces coefficients sont des paramètres de départ à mesurer, pas des performances prouvées :

- Plat : forme 30 %, historique comparable 20 %, jockey 10 %, entraîneur 10 %, poids 10 %, marché 10 %, régularité 5 %, corde 5 %.
- Trot : forme 25 %, historique comparable 15 %, driver 15 %, entraîneur 5 %, chronos 25 %, marché 10 %, régularité 5 %.
- Obstacle : forme 30 %, historique comparable 20 %, jockey 10 %, entraîneur 10 %, poids 10 %, marché 10 %, régularité 10 %.
- Discipline inconnue : forme 30 %, historique comparable 15 %, jockey/driver 8 %, entraîneur 7 %, marché 10 %, régularité 15 %, polyvalence neutre 15 %.

Le score du moteur sur 100 est un **indice de classement**, pas une probabilité de gagner ou de finir dans les quatre premiers. L'indice de confiance du consensus reste un indicateur de convergence et n'est pas encore une probabilité calibrée.

## Archivage historique

La profondeur configurée est de 1 095 jours. Cela déclenche un rattrapage progressif à partir des données accessibles via l'API PMU déjà utilisée par le projet. La disponibilité réelle des dates anciennes, les éventuelles limitations de l'API et les quotas Cloudflare détermineront la profondeur effectivement atteinte. Le ZIP ne contient pas de données PMU historiques préchargées. Le backtest ne pourra démarrer que lorsque les courses et les instantanés pré-course auront été archivés.

Le fichier `wrangler.jsonc` fourni pour cette préproduction reprend la configuration active communiquée par l'utilisateur (D1 `DB`, KV `CACHE_KV`, assets `ASSETS`, date de compatibilité, variables VAPID) et conserve les deux crons existants (`0 1 * * *`, `0 6 * * *`) en ajoutant `*/30 * * * *` et `*/15 * * * *`. Vérifier les secrets dans Cloudflare : ils ne figurent volontairement pas dans le fichier Wrangler. Le ZIP reste une préproduction et n'a pas été déployé.

## Données et migrations

Les nouvelles tables (`predictions_moteur`, `backtest_moteur`) et index d'archives sont créés automatiquement à la première utilisation via `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. Aucune table commerciale, compte utilisateur, abonnement, paiement, article ou contenu public n'a été volontairement modifié.

## Validation effectuée localement

- `node --check worker.js` : réussi après correction du curseur d'archivage.
- Vérification syntaxique du JavaScript intégré à `public/admin.html` : effectuée dans le contrôle final de ce paquet.
- Vérification des bindings Wrangler : `DB`, `CACHE_KV` et `ASSETS` correspondent au fichier actif transmis ; les quatre crons sont fusionnés sans supprimer les deux crons existants.
- Tests smoke ciblés : score de forme, pénalisation des disqualifications, fusion pondérée, filtrage des non-partants et doublons : réussis.
- Contrôle SQL local des requêtes d’historique et du stockage des résultats de backtest : réussi.
- Vérification syntaxique du script JavaScript de l’administration : réussie.

## Limites connues avant mise en production

- La qualité du moteur dépendra de la complétude des historiques PMU réellement récupérés.
- Les pondérations sont initiales ; elles devront être ajustées sur des résultats hors échantillon. Le déferrage n’est pas encore utilisé par le score numérique : le ZIP ne permet pas de confirmer un champ PMU fiable pour cette donnée, donc aucun indicateur n’est inventé.
- Les prédictions historiques des IA ne peuvent pas être recréées rétroactivement. Le backtest du moteur utilise les instantanés PMU archivés et les résultats antérieurs à chaque course ; la comparaison des IA commence à mesure que leurs nouvelles prédictions sont enregistrées et que les arrivées sont archivées.
- La qualité du backtest dépend de la fidélité des instantanés PMU archivés (notamment cotes, musique et historique détaillé). Les courses sans données exploitables sont ignorées dans les moyennes mais marquées comme traitées pour ne pas bloquer les lots.
- L'accès à la base D1 distante et au compte Cloudflare n'est pas disponible depuis cette session : le schéma distant, les données réelles, les secrets enregistrés et les triggers réellement actifs n'ont donc pas été interrogés. La validation D1 distante reste à effectuer avant déploiement.
- Les cotes PMU historisées proviennent de la réponse disponible au moment de l'archivage ; elles ne doivent pas être considérées automatiquement comme des cotes figées à l'heure pré-course. Le backtest les utilise comme signal seulement avec cette réserve.
