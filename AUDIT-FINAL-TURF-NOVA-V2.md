# Turf Nova AI V2 — clôture de l'audit de préproduction

Date : 21 novembre 2026

## Conclusion

**Audit de préproduction clôturé avec réserves de mise en production.** Le paquet V2 a été contrôlé localement et les vérifications D1 communiquées par le propriétaire confirment la présence des nouvelles structures. Le paquet est prêt pour une phase de déploiement contrôlé en environnement de test/préproduction, mais ce contrôle ne constitue pas une validation en production.

Aucun déploiement Cloudflare n'a été effectué par cette session.

## Vérifications D1 rapportées depuis la console Cloudflare

Les résultats transmis par le propriétaire confirment :

- `predictions_moteur` : présente, 8 colonnes conformes ;
- `backtest_moteur` : présente, 16 colonnes conformes ;
- index `idx_archive_courses_context`, `idx_archive_partants_driver_date` et `idx_archive_partants_entraineur_date` : présents ;
- les archives historiques existantes sont conservées ;
- `archive_courses` : 226 lignes, du 2026-11-14 au 2026-11-20 ;
- `archive_partants` : 2 695 lignes et 2 691 chevaux distincts (résultat communiqué lors de l'audit).

L'historique actuellement confirmé ne couvre donc que sept jours. La profondeur historique de trois ans est un objectif de rattrapage, pas un résultat déjà atteint.

## Vérifications techniques locales effectuées sur le ZIP

- Intégrité de l'archive ZIP : `unzip -t` réussi, aucune erreur de compression.
- `node --check worker.js` : réussi.
- Scripts JavaScript intégrés dans `public/admin.html` : vérification syntaxique réussie pour les trois blocs non vides.
- Migration SQL : exécutée dans SQLite local ; les tables `predictions_moteur` (8 colonnes) et `backtest_moteur` (16 colonnes) sont créées ; les index attendus sont présents.
- Configuration Wrangler : bindings `DB`, `CACHE_KV`, `ASSETS` et quatre expressions Cron présentes dans le fichier livré.
- Migration additive : les créations reposent sur `IF NOT EXISTS`; aucune instruction `DROP` n'est incluse dans le script de migration.

## Configuration et automatisations

Le paquet conserve les deux Cron préexistants et ajoute :

- `*/30 * * * *` : traitement d'archivage historique ;
- `*/15 * * * *` : pré-génération des pronostics.

Les secrets doivent être présents dans Cloudflare, jamais dans le ZIP ni transmis par message : `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `CHARIOW_API_KEY` si l'intégration de paiement l'utilise, `ADMIN_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM` et `VAPID_PRIVATE_KEY`. Les valeurs publiques VAPID sont dans la configuration Wrangler.

La présence effective de ces secrets et l'activation réelle des Cron n'ont pas été inspectées à distance dans cette session ; l'utilisateur indique que sa configuration est bonne.

## Limites de validation

Ce contrôle est un audit statique et local, complété par les sorties D1 fournies par le propriétaire. Il ne prouve pas le bon fonctionnement en conditions réelles des appels PMU, des fournisseurs IA, des emails, des paiements, des notifications push, des quotas, ni de tous les parcours du site. Aucun test d'intégration authentifié sur le compte Cloudflare n'a été exécuté.

## Conditions avant production

1. Conserver une copie du Worker et des fichiers actuellement en production.
2. Faire une sauvegarde D1 avant le déploiement.
3. Déployer d'abord sur un Worker de test/préproduction.
4. Vérifier les routes publiques et administratives, les abonnements, les appels IA, l'archivage et les quatre Cron dans les logs Cloudflare.
5. N'activer le rattrapage historique massif qu'après validation des quotas et des réponses de la source PMU.

## Retour arrière

Le ZIP source d'origine reste distinct et n'est pas modifié. En cas de problème, restaurer le code et la configuration du Worker précédent. Les nouvelles tables/index sont additifs ; ne pas supprimer manuellement les tables pendant un rollback.
