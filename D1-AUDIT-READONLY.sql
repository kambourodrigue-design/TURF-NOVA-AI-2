-- À exécuter dans la console D1 Cloudflare pour l'audit réel.
-- Requêtes strictement en lecture seule : aucune écriture, migration ou suppression.
SELECT type, name, tbl_name, sql
FROM sqlite_master
WHERE type IN ('table', 'index')
  AND (name LIKE 'archive_%' OR name LIKE '%moteur%' OR name = 'predictions_ia')
ORDER BY type, name;

PRAGMA table_info(archive_courses);
PRAGMA table_info(archive_partants);
PRAGMA table_info(predictions_ia);
PRAGMA table_info(predictions_moteur);
PRAGMA table_info(backtest_moteur);

SELECT COUNT(*) AS courses_archivees,
       MIN(date_iso) AS premiere_date,
       MAX(date_iso) AS derniere_date
FROM archive_courses;

SELECT COUNT(*) AS partants_archives,
       COUNT(DISTINCT cheval) AS chevaux_distincts
FROM archive_partants;
